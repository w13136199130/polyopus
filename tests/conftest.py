"""Test isolation: never use the developer's real model config.

Real env vars beat the .env file in pydantic-settings, so pinning them empty
here forces FakeModel in every test regardless of the local .env.
"""

from __future__ import annotations

import os

os.environ["POLY_MODEL_BASE_URL"] = ""
os.environ["POLY_MODEL_API_KEY"] = ""
os.environ["POLY_MODEL_NAME"] = ""
