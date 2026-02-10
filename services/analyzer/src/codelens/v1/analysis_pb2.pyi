from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class AnalyzeRequest(_message.Message):
    __slots__ = ("git_url", "ref")
    GIT_URL_FIELD_NUMBER: _ClassVar[int]
    REF_FIELD_NUMBER: _ClassVar[int]
    git_url: str
    ref: str
    def __init__(self, git_url: _Optional[str] = ..., ref: _Optional[str] = ...) -> None: ...

class AnalyzeResponse(_message.Message):
    __slots__ = ("id",)
    ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    def __init__(self, id: _Optional[str] = ...) -> None: ...

class AnalyzeStreamRequest(_message.Message):
    __slots__ = ("git_url", "ref")
    GIT_URL_FIELD_NUMBER: _ClassVar[int]
    REF_FIELD_NUMBER: _ClassVar[int]
    git_url: str
    ref: str
    def __init__(self, git_url: _Optional[str] = ..., ref: _Optional[str] = ...) -> None: ...

class AnalyzeStreamResponse(_message.Message):
    __slots__ = ("id", "phase", "progress", "message")
    ID_FIELD_NUMBER: _ClassVar[int]
    PHASE_FIELD_NUMBER: _ClassVar[int]
    PROGRESS_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    id: str
    phase: str
    progress: float
    message: str
    def __init__(self, id: _Optional[str] = ..., phase: _Optional[str] = ..., progress: _Optional[float] = ..., message: _Optional[str] = ...) -> None: ...

class GetAnalysisRequest(_message.Message):
    __slots__ = ("id",)
    ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    def __init__(self, id: _Optional[str] = ...) -> None: ...

class GetAnalysisResponse(_message.Message):
    __slots__ = ("id", "git_url", "ref", "summary", "frameworks", "patterns", "insights", "status", "error")
    ID_FIELD_NUMBER: _ClassVar[int]
    GIT_URL_FIELD_NUMBER: _ClassVar[int]
    REF_FIELD_NUMBER: _ClassVar[int]
    SUMMARY_FIELD_NUMBER: _ClassVar[int]
    FRAMEWORKS_FIELD_NUMBER: _ClassVar[int]
    PATTERNS_FIELD_NUMBER: _ClassVar[int]
    INSIGHTS_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    id: str
    git_url: str
    ref: str
    summary: str
    frameworks: _containers.RepeatedCompositeFieldContainer[Framework]
    patterns: _containers.RepeatedCompositeFieldContainer[Pattern]
    insights: _containers.RepeatedCompositeFieldContainer[Insight]
    status: str
    error: str
    def __init__(self, id: _Optional[str] = ..., git_url: _Optional[str] = ..., ref: _Optional[str] = ..., summary: _Optional[str] = ..., frameworks: _Optional[_Iterable[_Union[Framework, _Mapping]]] = ..., patterns: _Optional[_Iterable[_Union[Pattern, _Mapping]]] = ..., insights: _Optional[_Iterable[_Union[Insight, _Mapping]]] = ..., status: _Optional[str] = ..., error: _Optional[str] = ...) -> None: ...

class Framework(_message.Message):
    __slots__ = ("name", "version", "category", "confidence")
    NAME_FIELD_NUMBER: _ClassVar[int]
    VERSION_FIELD_NUMBER: _ClassVar[int]
    CATEGORY_FIELD_NUMBER: _ClassVar[int]
    CONFIDENCE_FIELD_NUMBER: _ClassVar[int]
    name: str
    version: str
    category: str
    confidence: float
    def __init__(self, name: _Optional[str] = ..., version: _Optional[str] = ..., category: _Optional[str] = ..., confidence: _Optional[float] = ...) -> None: ...

class Pattern(_message.Message):
    __slots__ = ("name", "description", "evidence_paths", "confidence")
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    EVIDENCE_PATHS_FIELD_NUMBER: _ClassVar[int]
    CONFIDENCE_FIELD_NUMBER: _ClassVar[int]
    name: str
    description: str
    evidence_paths: _containers.RepeatedScalarFieldContainer[str]
    confidence: float
    def __init__(self, name: _Optional[str] = ..., description: _Optional[str] = ..., evidence_paths: _Optional[_Iterable[str]] = ..., confidence: _Optional[float] = ...) -> None: ...

class Insight(_message.Message):
    __slots__ = ("category", "title", "description")
    CATEGORY_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    category: str
    title: str
    description: str
    def __init__(self, category: _Optional[str] = ..., title: _Optional[str] = ..., description: _Optional[str] = ...) -> None: ...
