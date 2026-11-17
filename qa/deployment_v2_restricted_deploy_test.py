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
        os.chmod(self.allowed_signers, 0o600)

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
                self.frame(spaced, pathlib.Path(str(source) + ".sig").read_bytes()),
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


if __name__ == "__main__":
    unittest.main(verbosity=2)
