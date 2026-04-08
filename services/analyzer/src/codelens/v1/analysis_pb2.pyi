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
    __slots__ = ("id", "phase", "progress", "message", "agent", "kind", "step", "step_total")
    ID_FIELD_NUMBER: _ClassVar[int]
    PHASE_FIELD_NUMBER: _ClassVar[int]
    PROGRESS_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    AGENT_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    STEP_FIELD_NUMBER: _ClassVar[int]
    STEP_TOTAL_FIELD_NUMBER: _ClassVar[int]
    id: str
    phase: str
    progress: float
    message: str
    agent: str
    kind: str
    step: int
    step_total: int
    def __init__(self, id: _Optional[str] = ..., phase: _Optional[str] = ..., progress: _Optional[float] = ..., message: _Optional[str] = ..., agent: _Optional[str] = ..., kind: _Optional[str] = ..., step: _Optional[int] = ..., step_total: _Optional[int] = ...) -> None: ...

class GetAnalysisRequest(_message.Message):
    __slots__ = ("id",)
    ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    def __init__(self, id: _Optional[str] = ...) -> None: ...

class GetAnalysisResponse(_message.Message):
    __slots__ = ("id", "git_url", "ref", "summary", "frameworks", "patterns", "insights", "status", "error", "services")
    ID_FIELD_NUMBER: _ClassVar[int]
    GIT_URL_FIELD_NUMBER: _ClassVar[int]
    REF_FIELD_NUMBER: _ClassVar[int]
    SUMMARY_FIELD_NUMBER: _ClassVar[int]
    FRAMEWORKS_FIELD_NUMBER: _ClassVar[int]
    PATTERNS_FIELD_NUMBER: _ClassVar[int]
    INSIGHTS_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    SERVICES_FIELD_NUMBER: _ClassVar[int]
    id: str
    git_url: str
    ref: str
    summary: str
    frameworks: _containers.RepeatedCompositeFieldContainer[Framework]
    patterns: _containers.RepeatedCompositeFieldContainer[Pattern]
    insights: _containers.RepeatedCompositeFieldContainer[Insight]
    status: str
    error: str
    services: _containers.RepeatedCompositeFieldContainer[ServiceModule]
    def __init__(self, id: _Optional[str] = ..., git_url: _Optional[str] = ..., ref: _Optional[str] = ..., summary: _Optional[str] = ..., frameworks: _Optional[_Iterable[_Union[Framework, _Mapping]]] = ..., patterns: _Optional[_Iterable[_Union[Pattern, _Mapping]]] = ..., insights: _Optional[_Iterable[_Union[Insight, _Mapping]]] = ..., status: _Optional[str] = ..., error: _Optional[str] = ..., services: _Optional[_Iterable[_Union[ServiceModule, _Mapping]]] = ...) -> None: ...

class ListReposRequest(_message.Message):
    __slots__ = ("limit", "offset")
    LIMIT_FIELD_NUMBER: _ClassVar[int]
    OFFSET_FIELD_NUMBER: _ClassVar[int]
    limit: int
    offset: int
    def __init__(self, limit: _Optional[int] = ..., offset: _Optional[int] = ...) -> None: ...

class ListReposResponse(_message.Message):
    __slots__ = ("repos",)
    REPOS_FIELD_NUMBER: _ClassVar[int]
    repos: _containers.RepeatedCompositeFieldContainer[RepoSummary]
    def __init__(self, repos: _Optional[_Iterable[_Union[RepoSummary, _Mapping]]] = ...) -> None: ...

class RepoSummary(_message.Message):
    __slots__ = ("git_url", "ref", "last_analysis_id", "last_status", "last_updated_at")
    GIT_URL_FIELD_NUMBER: _ClassVar[int]
    REF_FIELD_NUMBER: _ClassVar[int]
    LAST_ANALYSIS_ID_FIELD_NUMBER: _ClassVar[int]
    LAST_STATUS_FIELD_NUMBER: _ClassVar[int]
    LAST_UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    git_url: str
    ref: str
    last_analysis_id: str
    last_status: str
    last_updated_at: str
    def __init__(self, git_url: _Optional[str] = ..., ref: _Optional[str] = ..., last_analysis_id: _Optional[str] = ..., last_status: _Optional[str] = ..., last_updated_at: _Optional[str] = ...) -> None: ...

class DeleteRepoRequest(_message.Message):
    __slots__ = ("git_url", "ref")
    GIT_URL_FIELD_NUMBER: _ClassVar[int]
    REF_FIELD_NUMBER: _ClassVar[int]
    git_url: str
    ref: str
    def __init__(self, git_url: _Optional[str] = ..., ref: _Optional[str] = ...) -> None: ...

class DeleteRepoResponse(_message.Message):
    __slots__ = ("deleted_count",)
    DELETED_COUNT_FIELD_NUMBER: _ClassVar[int]
    deleted_count: int
    def __init__(self, deleted_count: _Optional[int] = ...) -> None: ...

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
    __slots__ = ("name", "description", "evidence_paths", "confidence", "category")
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    EVIDENCE_PATHS_FIELD_NUMBER: _ClassVar[int]
    CONFIDENCE_FIELD_NUMBER: _ClassVar[int]
    CATEGORY_FIELD_NUMBER: _ClassVar[int]
    name: str
    description: str
    evidence_paths: _containers.RepeatedScalarFieldContainer[str]
    confidence: float
    category: str
    def __init__(self, name: _Optional[str] = ..., description: _Optional[str] = ..., evidence_paths: _Optional[_Iterable[str]] = ..., confidence: _Optional[float] = ..., category: _Optional[str] = ...) -> None: ...

class Insight(_message.Message):
    __slots__ = ("category", "title", "description")
    CATEGORY_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    category: str
    title: str
    description: str
    def __init__(self, category: _Optional[str] = ..., title: _Optional[str] = ..., description: _Optional[str] = ...) -> None: ...

class FileDetail(_message.Message):
    __slots__ = ("path", "purpose", "layer")
    PATH_FIELD_NUMBER: _ClassVar[int]
    PURPOSE_FIELD_NUMBER: _ClassVar[int]
    LAYER_FIELD_NUMBER: _ClassVar[int]
    path: str
    purpose: str
    layer: str
    def __init__(self, path: _Optional[str] = ..., purpose: _Optional[str] = ..., layer: _Optional[str] = ...) -> None: ...

class ServiceModule(_message.Message):
    __slots__ = ("name", "description", "module_type", "entry_points", "key_files", "depends_on", "functions")
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    MODULE_TYPE_FIELD_NUMBER: _ClassVar[int]
    ENTRY_POINTS_FIELD_NUMBER: _ClassVar[int]
    KEY_FILES_FIELD_NUMBER: _ClassVar[int]
    DEPENDS_ON_FIELD_NUMBER: _ClassVar[int]
    FUNCTIONS_FIELD_NUMBER: _ClassVar[int]
    name: str
    description: str
    module_type: str
    entry_points: _containers.RepeatedScalarFieldContainer[str]
    key_files: _containers.RepeatedCompositeFieldContainer[FileDetail]
    depends_on: _containers.RepeatedScalarFieldContainer[str]
    functions: _containers.RepeatedCompositeFieldContainer[FunctionDetail]
    def __init__(self, name: _Optional[str] = ..., description: _Optional[str] = ..., module_type: _Optional[str] = ..., entry_points: _Optional[_Iterable[str]] = ..., key_files: _Optional[_Iterable[_Union[FileDetail, _Mapping]]] = ..., depends_on: _Optional[_Iterable[str]] = ..., functions: _Optional[_Iterable[_Union[FunctionDetail, _Mapping]]] = ...) -> None: ...

class FunctionDetail(_message.Message):
    __slots__ = ("name", "signature", "file_path", "start_line", "end_line", "purpose", "complexity")
    NAME_FIELD_NUMBER: _ClassVar[int]
    SIGNATURE_FIELD_NUMBER: _ClassVar[int]
    FILE_PATH_FIELD_NUMBER: _ClassVar[int]
    START_LINE_FIELD_NUMBER: _ClassVar[int]
    END_LINE_FIELD_NUMBER: _ClassVar[int]
    PURPOSE_FIELD_NUMBER: _ClassVar[int]
    COMPLEXITY_FIELD_NUMBER: _ClassVar[int]
    name: str
    signature: str
    file_path: str
    start_line: int
    end_line: int
    purpose: str
    complexity: str
    def __init__(self, name: _Optional[str] = ..., signature: _Optional[str] = ..., file_path: _Optional[str] = ..., start_line: _Optional[int] = ..., end_line: _Optional[int] = ..., purpose: _Optional[str] = ..., complexity: _Optional[str] = ...) -> None: ...

class GetFileSourceRequest(_message.Message):
    __slots__ = ("analysis_id", "file_path")
    ANALYSIS_ID_FIELD_NUMBER: _ClassVar[int]
    FILE_PATH_FIELD_NUMBER: _ClassVar[int]
    analysis_id: str
    file_path: str
    def __init__(self, analysis_id: _Optional[str] = ..., file_path: _Optional[str] = ...) -> None: ...

class GetFileSourceResponse(_message.Message):
    __slots__ = ("file_path", "language", "source", "functions", "total_lines")
    FILE_PATH_FIELD_NUMBER: _ClassVar[int]
    LANGUAGE_FIELD_NUMBER: _ClassVar[int]
    SOURCE_FIELD_NUMBER: _ClassVar[int]
    FUNCTIONS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_LINES_FIELD_NUMBER: _ClassVar[int]
    file_path: str
    language: str
    source: str
    functions: _containers.RepeatedCompositeFieldContainer[FunctionDetail]
    total_lines: int
    def __init__(self, file_path: _Optional[str] = ..., language: _Optional[str] = ..., source: _Optional[str] = ..., functions: _Optional[_Iterable[_Union[FunctionDetail, _Mapping]]] = ..., total_lines: _Optional[int] = ...) -> None: ...
