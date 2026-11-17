import base64
import hashlib
import importlib.util
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parent
MODULE_PATH = ROOT / "deployment-v2-restricted-deploy.py"
SPEC = importlib.util.spec_from_file_location("cqrtv_restricted_deploy", MODULE_PATH)
agent = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(agent)


def request(**overrides):
    value = {
        "schema_version": 1,
        "release_sha": "a" * 40,
        "run_id": "12345",
        "project_root": "/docker/playcqrtv",
        "manifest_sha256": "c" * 64,
        "web_image_ref": "ghcr.io/fnatika1996/playcqrtv-platform@sha256:" + "b" * 64,
        "api_image_ref": "ghcr.io/fnatika1996/playcqrtv-api@sha256:" + "d" * 64,
        "previous_web_ref": "ghcr.io/fnatika1996/playcqrtv-platform@sha256:" + "e" * 64,
        "previous_api_ref": "ghcr.io/fnatika1996/playcqrtv-api@sha256:" + "f" * 64,
    }
    value.update(overrides)
    return value


class SigningFixture(unittest.TestCase):
    def setUp(self):
        if not shutil.which("ssh-keygen"):
            self.skipTest("OpenSSH ssh-keygen is unavailable.")
        self.temp = tempfile.TemporaryDirectory(prefix="cqrtv-sign-test-", dir=ROOT)
        self.addCleanup(self.temp.cleanup)
        self.directory = pathlib.Path(self.temp.name)
        self.private_key = self.directory / "release-signing-key"
        subprocess.run(
            ["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "cqrtv-release", "-f", str(self.private_key)],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        public_fields = self.private_key.with_suffix(".pub").read_text().split()
        self.allowed_signers = self.directory / "allowed_signers"
        self.allowed_signers.write_text(
            'cqrtv-release namespaces="cqrtv-release" ' + public_fields[0] + " " + public_fields[1] + "\n"
        )
        os.chmod(self.allowed_signers, 0o400)

    def sign_raw(self, raw):
        source = self.directory / "payload.json"
        source.write_bytes(raw)
        subprocess.run(
            ["ssh-keygen", "-q", "-Y", "sign", "-f", str(self.private_key), "-n", "cqrtv-release", str(source)],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        return raw, pathlib.Path(str(source) + ".sig").read_bytes()

    def sign(self, payload):
        raw = (json.dumps(payload, separators=(",", ":"), ensure_ascii=False) + "\n").encode()
        return self.sign_raw(raw)

    def frame(self, raw, signature):
        return b"CQRTV-DEPLOY-REQUEST-V1\n" + base64.b64encode(signature) + b"\n" + base64.b64encode(raw) + b"\n"

    def test_only_valid_signed_canonical_request_is_accepted(self):
        raw, signature = self.sign(request())
        parsed, payload_hash = agent.decode_frame(
            self.frame(raw, signature), str(self.allowed_signers), owner_uid=os.getuid()
        )
        self.assertEqual(parsed, request())
        self.assertEqual(payload_hash, hashlib.sha256(raw).hexdigest())
        agent.validate_request(parsed, {
            "project_root": "/docker/playcqrtv",
        })

    def test_tampered_payload_and_wrong_signer_are_rejected(self):
        raw, signature = self.sign(request())
        tampered = raw.replace(b'"run_id":"12345"', b'"run_id":"12346"')
        with self.assertRaises(agent.DeployError):
            agent.decode_frame(self.frame(tampered, signature), str(self.allowed_signers), owner_uid=os.getuid())
        with tempfile.TemporaryDirectory(prefix="cqrtv-other-key-") as other:
            other_key = pathlib.Path(other) / "other"
            subprocess.run(
                ["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(other_key)],
                check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            other_pub = other_key.with_suffix(".pub").read_text().split()
            (self.directory / "other-allowed").write_text(
                'cqrtv-release namespaces="cqrtv-release" ' + other_pub[0] + " " + other_pub[1] + "\n"
            )
            with self.assertRaises(agent.DeployError):
                agent.decode_frame(self.frame(raw, signature), str(self.directory / "other-allowed"), owner_uid=os.getuid())

    def test_duplicate_json_keys_noncanonical_data_and_bad_framing_fail_closed(self):
        duplicate = b'{"schema_version":1,"schema_version":1}\n'
        raw, signature = self.sign_raw(duplicate)
        with self.assertRaises(agent.DeployError):
            agent.decode_frame(self.frame(duplicate, signature), str(self.allowed_signers), owner_uid=os.getuid())
        spaced = json.dumps(request(), indent=2).encode()
        _, signature_spaced = self.sign_raw(spaced)
        with self.assertRaises(agent.DeployError):
            agent.decode_frame(
                self.frame(spaced, signature_spaced),
                str(self.allowed_signers), owner_uid=os.getuid(),
            )
        with self.assertRaises(agent.DeployError):
            agent.decode_frame(b"CQRTV-DEPLOY-REQUEST-V1\n\n\nextra", str(self.allowed_signers), owner_uid=os.getuid())

    def test_request_only_accepts_fixed_paths_and_digest_repositories(self):
        base = request()
        config = {"project_root": "/docker/playcqrtv"}
        for change in [
            {"project_root": "/tmp/attacker"},
            {"release_sha": "../etc/passwd"},
            {"manifest_sha256": "latest"},
            {"web_image_ref": "attacker.invalid/web@sha256:" + "a" * 64},
            {"api_image_ref": "ghcr.io/fnatika1996/playcqrtv-api:latest"},
            {"previous_api_ref": "ghcr.io/fnatika1996/playcqrtv-platform@sha256:" + "f" * 64},
            {"run_id": "0"},
        ]:
            with self.subTest(change=change), self.assertRaises(agent.DeployError):
                agent.validate_request({**base, **change}, config)

    def test_generated_override_contains_only_fixed_services_and_image_digests(self):
        path = self.directory / "override.yml"
        payload = request()
        agent._build_override(payload["web_image_ref"], payload["api_image_ref"], str(path))
        content = path.read_text()
        self.assertEqual(content.count("services:"), 1)
        self.assertIn("  api:\n    image: " + payload["api_image_ref"] + "\n    pull_policy: never", content)
        self.assertIn("  caddy:\n    image: " + payload["web_image_ref"] + "\n    pull_policy: never", content)
        self.assertNotRegex(content, r"(?m)^\s+(?:command|entrypoint|volumes|privileged|devices|build):")
        with self.assertRaises(agent.DeployError):
            agent._build_override("ghcr.io/attacker/image@sha256:" + "a" * 64, payload["api_image_ref"], str(self.directory / "bad.yml"))


class StateAndComposePolicyTests(unittest.TestCase):
    def setUp(self):
        self.payload = request()
        self.config = {"volume_names": dict(agent.VOLUME_NAMES)}

    def services(self, api="api_image_ref", web="web_image_ref"):
        return {
            "api": {"repo_digests": [self.payload[api]]},
            "caddy": {"repo_digests": [self.payload[web]]},
        }

    def test_target_noop_and_previous_apply_are_distinct_states(self):
        self.assertEqual(agent._classify_refs(self.services(), self.payload), "target")
        self.assertEqual(agent._classify_refs(
            self.services("previous_api_ref", "previous_web_ref"), self.payload
        ), "previous")

    def test_mixed_or_unknown_digests_are_rejected(self):
        with self.assertRaises(agent.DeployError):
            agent._classify_refs(self.services("api_image_ref", "previous_web_ref"), self.payload)
        unknown = self.services()
        unknown["api"]["repo_digests"] = ["ghcr.io/other/api@sha256:" + "1" * 64]
        with self.assertRaises(agent.DeployError):
            agent._classify_refs(unknown, self.payload)

    def test_compose_policy_rejects_wrong_images_services_volumes_and_extra_mounts(self):
        payload = self.payload
        image = {
            "api": payload["api_image_ref"], "caddy": payload["web_image_ref"],
            "db": "postgres:17-alpine", "secret-init": "alpine:3.21",
        }
        mounts = {
            "api": [{"type": "volume", "source": "db_secret", "target": "/run/db-secret"}],
            "db": [
                {"type": "volume", "source": "postgres_data", "target": "/var/lib/postgresql/data"},
                {"type": "volume", "source": "db_secret", "target": "/run/db-secret"},
            ],
            "caddy": [
                {"type": "volume", "source": "caddy_data", "target": "/data"},
                {"type": "volume", "source": "caddy_config", "target": "/config"},
            ],
            "secret-init": [{"type": "volume", "source": "db_secret", "target": "/run/db-secret"}],
        }
        good = {
            "services": {
                name: {"image": image[name], "volumes": mounts[name], **({"pull_policy": "never"} if name in ("api", "caddy") else {})}
                for name in agent.SERVICES
            },
            "volumes": {key: {"name": value} for key, value in agent.VOLUME_NAMES.items()},
        }
        agent._validate_compose_config(good, self.config, payload)
        bad_cases = []
        bad = json.loads(json.dumps(good)); bad["services"]["api"]["image"] = "attacker:latest"; bad_cases.append(bad)
        bad = json.loads(json.dumps(good)); bad["services"]["caddy"]["volumes"].append({"type": "bind", "source": "/host", "target": "/mnt"}); bad_cases.append(bad)
        bad = json.loads(json.dumps(good)); bad["services"]["db"]["volumes"][0]["source"] = "new_db"; bad_cases.append(bad)
        bad = json.loads(json.dumps(good)); del bad["services"]["db"]; bad_cases.append(bad)
        bad = json.loads(json.dumps(good)); bad["volumes"]["postgres_data"]["name"] = "other_postgres_data"; bad_cases.append(bad)
        for bad in bad_cases:
            with self.subTest(bad=bad), self.assertRaises(agent.DeployError):
                agent._validate_compose_config(bad, self.config, payload)

    def test_replay_state_rejects_older_run_and_reused_id_with_new_payload(self):
        current = {"run_id": "200", "payload_sha256": "a" * 64}
        with self.assertRaises(agent.DeployError):
            agent._check_replay(current, {**self.payload, "run_id": "199"}, "b" * 64)
        with self.assertRaises(agent.DeployError):
            agent._check_replay(current, {**self.payload, "run_id": "200"}, "b" * 64)
        agent._check_replay(current, {**self.payload, "run_id": "200"}, "a" * 64)



class DeploymentFlowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="cqrtv-flow-test-", dir=ROOT)
        self.addCleanup(self.temp.cleanup)
        self.lock_path = str(pathlib.Path(self.temp.name) / "deploy.lock")
        self.payload = request()
        self.config = {"project_name": "playcqrtv", "project_root": "/docker/playcqrtv",
                       "compose_file": "/docker/playcqrtv/docker-compose.yml",
                       "state_file": "/var/lib/cqrtv-deploy/state.json",
                       "volume_names": dict(agent.VOLUME_NAMES)}
        self.document = {
            "services": {
                "api": {"image": self.payload["api_image_ref"], "pull_policy": "never",
                        "volumes": [{"type": "volume", "source": "db_secret", "target": "/run/db-secret"}]},
                "caddy": {"image": self.payload["web_image_ref"], "pull_policy": "never",
                          "volumes": [
                              {"type": "volume", "source": "caddy_data", "target": "/data"},
                              {"type": "volume", "source": "caddy_config", "target": "/config"}]},
                "db": {"image": "postgres:17-alpine", "volumes": [
                    {"type": "volume", "source": "postgres_data", "target": "/var/lib/postgresql/data"},
                    {"type": "volume", "source": "db_secret", "target": "/run/db-secret"}]},
                "secret-init": {"image": "alpine:3.21", "volumes": [
                    {"type": "volume", "source": "db_secret", "target": "/run/db-secret"}]},
            },
            "volumes": {key: {"name": value} for key, value in agent.VOLUME_NAMES.items()},
        }
        self.previous = {
            "api": {"repo_digests": [self.payload["previous_api_ref"]], "configured_image": self.payload["previous_api_ref"]},
            "caddy": {"repo_digests": [self.payload["previous_web_ref"]], "configured_image": self.payload["previous_web_ref"]},
            "db": {"id": "db-container-1", "configured_image": "postgres:17-alpine"},
            "secret-init": {"configured_image": "alpine:3.21"},
        }
        self.target = {
            "api": {"repo_digests": [self.payload["api_image_ref"]]},
            "caddy": {"repo_digests": [self.payload["web_image_ref"]]},
            "db": {"id": "db-container-1"},
        }
        self.commands = []

    def command(self, args, *, runner=subprocess.run, timeout=30):
        self.commands.append(list(args))
        if args[-3:] == ["config", "--format", "json"]:
            return json.dumps(self.document).encode()
        if args[-3:] == ["pull", "api", "caddy"]:
            return b""
        if len(args) >= 3 and args[1:3] == ["image", "inspect"]:
            return json.dumps([self.payload["api_image_ref"] if args[-1] == self.payload["api_image_ref"]
                               else self.payload["web_image_ref"]]).encode()
        if "up" in args:
            return b""
        raise AssertionError("Unexpected Docker command: " + " ".join(args))

    def execute_flow(self, inventories, *, command=None, attempts=1):
        with mock.patch.object(agent, "LOCK_FILE", self.lock_path), \
             mock.patch.object(agent, "_safe_project_files"), \
             mock.patch.object(agent, "_read_state", return_value={"schema_version": 1, "run_id": "0", "payload_sha256": ""}), \
             mock.patch.object(agent, "_write_state") as write_state, \
             mock.patch.object(agent, "_compose_base", return_value=["/usr/bin/docker", "compose"]), \
             mock.patch.object(agent, "_inventory", side_effect=inventories), \
             mock.patch.object(agent, "_command", side_effect=command or self.command):
            result = agent.perform_deployment(
                self.payload, "a" * 64, self.config, attempts=attempts, sleep=lambda _seconds: None,
                owner_uid=os.getuid(),
            )
        return result, write_state

    def test_correct_digest_apply_only_pulls_and_recreates_app_services(self):
        result, write_state = self.execute_flow([self.previous, self.target])
        self.assertIn("target digests are running", result)
        self.assertEqual(len(self.commands), 5)
        self.assertTrue(any(command[-3:] == ["pull", "api", "caddy"] for command in self.commands))
        self.assertTrue(any(command[-6:] == ["up", "-d", "--no-build", "--no-deps", "api", "caddy"] for command in self.commands))
        self.assertFalse(any("down" in command or "db" in command for command in self.commands))
        write_state.assert_called_once()

    def test_repeat_on_healthy_target_is_noop(self):
        result, write_state = self.execute_flow([self.target])
        self.assertIn("no-op success", result)
        self.assertFalse(any(command[-3:] == ["pull", "api", "caddy"] or "up" in command for command in self.commands))
        write_state.assert_called_once()

    def test_mixed_state_stops_before_pull(self):
        mixed = dict(self.previous)
        mixed["caddy"] = self.target["caddy"]
        with self.assertRaises(agent.DeployError):
            self.execute_flow([mixed])
        self.assertFalse(any("pull" in command or "up" in command for command in self.commands))

    def test_pull_error_never_reaches_compose_up(self):
        def fail_pull(args, *, runner=subprocess.run, timeout=30):
            if args[-3:] == ["pull", "api", "caddy"]:
                raise agent.DeployError("simulated pull failure")
            return self.command(args, runner=runner, timeout=timeout)
        with self.assertRaises(agent.DeployError):
            self.execute_flow([self.previous], command=fail_pull)
        self.assertFalse(any("up" in command for command in self.commands))

    def test_lost_up_response_reconciles_observed_target_without_retry(self):
        def uncertain_up(args, *, runner=subprocess.run, timeout=30):
            self.commands.append(list(args))
            if "up" in args:
                raise agent.DeployError("simulated lost response")
            if args[-3:] == ["config", "--format", "json"]:
                return json.dumps(self.document).encode()
            if args[-3:] == ["pull", "api", "caddy"]:
                return b""
            if len(args) >= 3 and args[1:3] == ["image", "inspect"]:
                return json.dumps([args[-1]]).encode()
            raise AssertionError("Unexpected Docker command")
        result, _ = self.execute_flow([self.previous, self.target], command=uncertain_up, attempts=1)
        self.assertIn("target digests are running", result)
        self.assertEqual(sum("up" in command for command in self.commands), 1)



if __name__ == "__main__":
    unittest.main(verbosity=2)
