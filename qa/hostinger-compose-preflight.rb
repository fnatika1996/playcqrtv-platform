#!/usr/bin/env ruby
require "yaml"

def fail_closed
  warn "Hostinger saved Compose failed fail-closed preflight."
  exit 1
end

begin
  source = STDIN.read
  fail_closed if source.empty? || source.bytesize > 256 * 1024
  document = YAML.safe_load(source, permitted_classes: [], permitted_symbols: [], aliases: false)
  fail_closed unless document.is_a?(Hash)

  services = document["services"]
  volumes = document["volumes"]
  fail_closed unless services.is_a?(Hash) && volumes.is_a?(Hash)

  expected_services = %w[api caddy db secret-init].sort
  fail_closed unless services.keys.sort == expected_services
  fail_closed unless volumes.keys.sort == %w[caddy_config caddy_data db_secret postgres_data].sort

  expected_api_ref = ENV["EXPECTED_API_IMAGE_REF"]
  expected_web_ref = ENV["EXPECTED_WEB_IMAGE_REF"]
  digest_ref = /\Aghcr\.io\/fnatika1996\/playcqrtv-(?:api|platform)@sha256:[a-f0-9]{64}\z/i
  fail_closed unless expected_api_ref.is_a?(String) && expected_api_ref.match?(digest_ref) && expected_api_ref.start_with?("ghcr.io/fnatika1996/playcqrtv-api@")
  fail_closed unless expected_web_ref.is_a?(String) && expected_web_ref.match?(digest_ref) && expected_web_ref.start_with?("ghcr.io/fnatika1996/playcqrtv-platform@")
  fail_closed unless services.dig("api", "image") == expected_api_ref
  fail_closed unless services.dig("caddy", "image") == expected_web_ref
  fail_closed unless services.dig("api", "pull_policy") == "always"
  fail_closed unless services.dig("caddy", "pull_policy") == "always"

  expected_bindings = {
    "secret-init" => [["db_secret", "/run/db-secret"]],
    "db" => [["db_secret", "/run/db-secret"], ["postgres_data", "/var/lib/postgresql/data"]],
    "api" => [["db_secret", "/run/db-secret"]],
    "caddy" => [["caddy_config", "/config"], ["caddy_data", "/data"]]
  }

  expected_bindings.each do |service_name, expected|
    service = services[service_name]
    fail_closed unless service.is_a?(Hash)
    entries = service["volumes"]
    fail_closed unless entries.is_a?(Array)

    actual = entries.map do |entry|
      if entry.is_a?(String)
        parts = entry.split(":", 3)
        fail_closed if parts.length < 2
        [parts[0], parts[1]]
      elsif entry.is_a?(Hash)
        [entry["source"], entry["target"]]
      else
        fail_closed
      end
    end
    fail_closed unless actual.sort == expected.sort
  end

  puts "Hostinger saved Compose passed image and volume preflight."
rescue StandardError
  fail_closed
end
