"""
Shared pydantic field types for multipart form endpoints.

``flask_openapi3``'s ``FileStorage`` needs a pydantic core schema before it can
appear in a request model. The subclass below supplies one.

⚠️ Declare an upload as a plain ``FileStorage`` — never ``FileStorage | None``.
With a union, flask_openapi3 stops recognising the field as a file field and
never maps it from ``request.files``, so real uploads are dropped without a word.
Optionality comes from a ``Field(None, ...)`` default instead. That mistake has
already shipped twice (AivinNet-Client#36 → #167/#39), and it only ever shows up
in a full request cycle — which is why form models belong in ``tests_api/``.

``api/auth.py`` and ``api/playlist.py`` still carry their own identical copies
of this class from before it had a shared home; folding them in here is a
worthwhile follow-up, not something to do inside an unrelated feature branch.
"""

from typing import Any

from flask_openapi3 import FileStorage as _FileStorage
from pydantic import GetCoreSchemaHandler
from pydantic_core import core_schema


class FileStorage(_FileStorage):
    @classmethod
    def __get_pydantic_core_schema__(cls, _source: Any, handler: GetCoreSchemaHandler) -> core_schema.CoreSchema:
        return core_schema.with_info_plain_validator_function(cls.validate)
