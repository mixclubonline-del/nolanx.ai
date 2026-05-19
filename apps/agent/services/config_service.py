import os
import traceback
import toml
import requests

DEFAULT_PROVIDERS_CONFIG = {}
CONFIG_FILE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".")


class ConfigService:
    def __init__(self):
        self.app_config = DEFAULT_PROVIDERS_CONFIG
        self.root_dir = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
        self.config_file = os.path.join(CONFIG_FILE_DIR, "config.toml")
        self._load_config_from_file()

    def _set_if_env(self, config, section, key, env_name, cast=None):
        value = os.environ.get(env_name)
        if value is None or value == "":
            return

        config.setdefault(section, {})
        config[section][key] = cast(value) if cast else value

    def _apply_env_overrides(self, config):
        self._set_if_env(config, "openrouter", "api_key", "OPENROUTER_API_KEY")
        self._set_if_env(config, "openrouter", "model", "OPENROUTER_MODEL")
        self._set_if_env(config, "openrouter", "site_url", "NEXT_PUBLIC_APP_URL")

        self._set_if_env(config, "fal_ai", "api_key", "IMAGE_API_KEY")
        self._set_if_env(config, "fal_ai", "image_model", "IMAGE_MODEL")
        self._set_if_env(config, "fal_ai", "image_edit_model", "IMAGE_EDIT_MODEL")
        self._set_if_env(config, "fal_ai", "api_key", "FAL_KEY")
        self._set_if_env(config, "fal_ai", "api_key", "REELMIND_FAL_KEY")

        self._set_if_env(config, "reelmind", "api_key", "VIDEO_API_KEY")
        self._set_if_env(config, "reelmind", "model", "VIDEO_MODEL")
        self._set_if_env(config, "reelmind", "endpoint", "VIDEO_API_ENDPOINT")
        self._set_if_env(config, "reelmind", "task_endpoint_base", "VIDEO_TASK_API_BASE")

        self._set_if_env(config, "r2_storage", "account_id", "R2_ACCOUNT_ID")
        self._set_if_env(config, "r2_storage", "access_key_id", "R2_ACCESS_KEY_ID")
        self._set_if_env(config, "r2_storage", "secret_access_key", "R2_SECRET_ACCESS_KEY")
        self._set_if_env(config, "r2_storage", "bucket_name", "R2_BUCKET_NAME")
        self._set_if_env(config, "r2_storage", "public_url", "R2_PUBLIC_URL")

        self._set_if_env(config, "nolanx_api", "url", "NEXT_PUBLIC_API_BASE_URL")
        self._set_if_env(config, "nolanx_api", "internal_api_key", "INTERNAL_API_KEY")
        self._set_if_env(config, "system", "environment", "NODE_ENV")
        self._set_if_env(config, "server", "host", "AGENT_HOST")
        self._set_if_env(config, "server", "port", "AGENT_PORT", int)
        return config

    def _with_defaults(self, config):
        config.setdefault("openrouter", {})
        config["openrouter"].setdefault("url", "https://openrouter.ai/api/v1")
        config["openrouter"].setdefault("model", "google/gemini-3.5-flash")
        config["openrouter"].setdefault("site_url", "http://localhost:3000")
        config["openrouter"].setdefault("site_name", "NolanX")
        config["openrouter"].setdefault("max_tokens", 8192)
        config["openrouter"].setdefault("disable_streaming", True)

        config.setdefault("fal_ai", {})
        config["fal_ai"].setdefault("image_model", "openai/gpt-image-2")
        config["fal_ai"].setdefault("image_edit_model", "openai/gpt-image-2")

        config.setdefault("reelmind", {})
        config["reelmind"].setdefault("endpoint", "https://nestapi.reelmind.ai/external-api/video/generate")
        config["reelmind"].setdefault("task_endpoint_base", "https://nestapi.reelmind.ai/external-api/video/task")
        config["reelmind"].setdefault("model", "dreamina-seedance-2-0-260128")

        config.setdefault("r2_storage", {})

        config.setdefault("nolanx_api", {})
        config["nolanx_api"].setdefault("url", "http://localhost:8080")
        config["nolanx_api"].setdefault("internal_api_key", "dev-internal-api-key")

        config.setdefault("system", {})
        config["system"].setdefault("user_data_dir", "./user_data")
        config["system"].setdefault("config_path", "config.toml")
        config["system"].setdefault("environment", "development")
        config["system"].setdefault("production_domain", "localhost")

        config.setdefault("server", {})
        config["server"].setdefault("host", "127.0.0.1")
        config["server"].setdefault("port", 52178)

        config.setdefault("nolanx", {})
        config["nolanx"].setdefault(
            "provider_preferences",
            {
                "text": ["openrouter"],
                "image": ["fal_ai"],
                "audio": ["fal_ai"],
                "video": ["reelmind"],
            },
        )
        return config

    def _merge_runtime_config_from_api(self, config):
        try:
            api_config = config.get('nolanx_api', {}) or {}
            base_url = str(api_config.get('url') or 'http://localhost:8080').rstrip('/')
            token = str(api_config.get('internal_api_key') or 'dev-internal-api-key').strip()
            response = requests.get(
                f"{base_url}/runtime-config",
                headers={
                    'Authorization': 'Bearer nolanx-local-dev-token',
                    'X-API-Key': token,
                    'Accept': 'application/json',
                },
                timeout=5,
            )
            if response.status_code >= 400:
                print(f"⚠️ Runtime config fetch skipped: HTTP {response.status_code}")
                return config

            payload = response.json() or {}
            data = payload.get('data') if isinstance(payload, dict) else None
            runtime_config = data.get('config') if isinstance(data, dict) else None
            if not isinstance(runtime_config, dict):
                return config

            openrouter = config.setdefault('openrouter', {})
            fal_ai = config.setdefault('fal_ai', {})
            reelmind = config.setdefault('reelmind', {})
            r2_storage = config.setdefault('r2_storage', {})

            if runtime_config.get('openrouter_api_key'):
                openrouter['api_key'] = str(runtime_config.get('openrouter_api_key')).strip()
            if runtime_config.get('openrouter_model'):
                openrouter['model'] = str(runtime_config.get('openrouter_model')).strip()

            if runtime_config.get('image_api_key'):
                fal_ai['api_key'] = str(runtime_config.get('image_api_key')).strip()
            if runtime_config.get('image_model'):
                fal_ai['image_model'] = str(runtime_config.get('image_model')).strip()
            if runtime_config.get('image_edit_model'):
                fal_ai['image_edit_model'] = str(runtime_config.get('image_edit_model')).strip()

            if runtime_config.get('video_api_key'):
                reelmind['api_key'] = str(runtime_config.get('video_api_key')).strip()
            if runtime_config.get('video_model'):
                reelmind['model'] = str(runtime_config.get('video_model')).strip()

            if runtime_config.get('r2_account_id'):
                r2_storage['account_id'] = str(runtime_config.get('r2_account_id')).strip()
            if runtime_config.get('r2_access_key_id'):
                r2_storage['access_key_id'] = str(runtime_config.get('r2_access_key_id')).strip()
            if runtime_config.get('r2_secret_access_key'):
                r2_storage['secret_access_key'] = str(runtime_config.get('r2_secret_access_key')).strip()
            if runtime_config.get('r2_bucket_name'):
                r2_storage['bucket_name'] = str(runtime_config.get('r2_bucket_name')).strip()
            if runtime_config.get('r2_public_url'):
                r2_storage['public_url'] = str(runtime_config.get('r2_public_url')).strip()

            print("✅ Runtime config synced from API")
            return config
        except Exception as exc:
            print(f"⚠️ Runtime config sync skipped: {exc}")
            return config

    def _load_config_from_file(self):
        try:
            if os.path.exists(self.config_file):
                with open(self.config_file, 'r') as f:
                    config = toml.load(f)
            else:
                config = {}
            config = self._with_defaults(config)
            config = self._apply_env_overrides(config)
            config = self._merge_runtime_config_from_api(config)
            self.app_config = config
            print(f"✅ Config loaded: {self.config_file}")
            print(f"📋 Services: {list(config.keys())}")
        except Exception as e:
            print(f"❌ Config load error {self.config_file}: {e}")
            traceback.print_exc()
            self.app_config = self._with_defaults({})

    def reload(self):
        self._load_config_from_file()
        return self.app_config

    def get_config(self):
        return self.app_config

    def get_nolanx_api_config(self):
        return self.app_config.get('nolanx_api', {})

    def get_reelmind_server_config(self):
        return self.get_nolanx_api_config()

    def get_reelmind_server_url(self):
        return self.get_nolanx_api_config().get('url', 'http://localhost:8080')

    def get_internal_api_key(self):
        return self.get_nolanx_api_config().get('internal_api_key')

    def get_system_config(self):
        return self.app_config.get('system', {})

    def get_environment(self):
        return self.get_system_config().get('environment', 'development')

    def get_production_domain(self):
        return self.get_system_config().get('production_domain')

    def is_development(self):
        return self.get_environment() == 'development'

    def is_production(self):
        return self.get_environment() == 'production'

    def get_server_config(self):
        return self.app_config.get('server', {})

    def get_server_host(self):
        return self.get_server_config().get('host', '127.0.0.1')

    def get_server_port(self):
        return self.get_server_config().get('port', 52178)

    def get_service_config(self, service_name):
        return self.app_config.get(service_name, {})

    async def update_config(self, data):
        try:
            merged = self._with_defaults(data or {})
            os.makedirs(os.path.dirname(self.config_file), exist_ok=True)
            with open(self.config_file, 'w') as f:
                toml.dump(merged, f)
            self.app_config = self._apply_env_overrides(merged)
            self.app_config = self._merge_runtime_config_from_api(self.app_config)
            return {"status": "success", "message": "Configuration updated successfully"}
        except Exception as e:
            traceback.print_exc()
            return {"status": "error", "message": str(e)}


config_service = ConfigService()
