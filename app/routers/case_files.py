"""Endpoints for files uploaded to an audit case/project (spec-020).

El archivo se guarda a disco (`app/rag/case_file_storage.py`) Y se ingesta en el vector store
tageado con el `case_id` real (`app/rag/ingestion.py`), para que `search_evidence` pueda
encontrarlo (best-effort, ver docstring de `app/rag/retrieval.py::retrieve`) sin ninguna tool
nueva -- mismo criterio de diseño que el plan de migración ya aprobó.
"""

from __future__ import annotations

import tempfile
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import CurrentUser, get_current_user
from app.errors import api_error_detail
from app.models.audit_case import AuditCase
from app.models.case_file import CaseFile
from app.rag.case_file_storage import delete_case_file_blob, write_case_file_blob
from app.rag.ingestion import UnsupportedFormatError, compute_doc_hash, ingest_document
from app.rag.vectorstore import get_collection
from app.schemas.case_file import CaseFileOut

router = APIRouter(prefix="/api/audit-cases", tags=["case-files"])


def _get_case_or_404(db: Session, case_id: str) -> AuditCase:
    case = db.get(AuditCase, case_id)
    if case is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=api_error_detail(
                status.HTTP_404_NOT_FOUND, "Audit case not found", "audit_case_not_found"
            ),
        )
    return case


def _get_case_file_or_404(db: Session, case_id: str, file_id: str) -> CaseFile:
    case_file = db.get(CaseFile, file_id)
    if case_file is None or case_file.case_id != case_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=api_error_detail(
                status.HTTP_404_NOT_FOUND, "Case file not found", "case_file_not_found"
            ),
        )
    return case_file


@router.post(
    "/{case_id}/files", response_model=CaseFileOut, status_code=status.HTTP_201_CREATED
)
async def upload_case_file(
    case_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> CaseFile:
    """Sube un archivo a un proyecto: lo guarda y lo ingesta en Chroma con `case_id` real."""
    _get_case_or_404(db, case_id)

    content = await file.read()
    filename = file.filename or "archivo_sin_nombre"

    case_file = CaseFile(
        id=str(uuid.uuid4()),
        case_id=case_id,
        filename=filename,
        size_bytes=len(content),
        doc_hash=compute_doc_hash(content),
        blob_path="",
        chunks_indexed=0,
    )

    # `ingest_document` necesita un path real en disco (extractors PDF/DOCX/XLSX leen del
    # filesystem) -- se escribe a un directorio temporal preservando el NOMBRE ORIGINAL (no
    # `NamedTemporaryFile`, que le pondría un nombre random): `ingest_document` deriva `source`
    # de `file_path.name` cuando no se pasa `base_dir`, así que la cita en `search_evidence`
    # debe mostrar el nombre real que subió el humano, no un nombre de archivo temporal.
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir) / filename
        tmp_path.write_bytes(content)
        try:
            result = ingest_document(tmp_path, get_collection(), case_id=case_id)
        except UnsupportedFormatError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=api_error_detail(status.HTTP_400_BAD_REQUEST, str(exc), "unsupported_format"),
            ) from exc
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=api_error_detail(
                    status.HTTP_500_INTERNAL_SERVER_ERROR, f"Fallo la ingesta: {exc}", "ingestion_failed"
                ),
            ) from exc

    case_file.chunks_indexed = result.chunks_indexed
    case_file.blob_path = write_case_file_blob(case_id, case_file.id, filename, content)

    db.add(case_file)
    db.commit()
    db.refresh(case_file)
    return case_file


@router.get("/{case_id}/files", response_model=list[CaseFileOut])
def list_case_files(
    case_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[CaseFile]:
    _get_case_or_404(db, case_id)
    return (
        db.query(CaseFile)
        .filter(CaseFile.case_id == case_id)
        .order_by(CaseFile.created_at.desc())
        .all()
    )


@router.delete("/{case_id}/files/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_case_file(
    case_id: str,
    file_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    """Borra una fuente cargada en un proyecto y limpia sus artefactos asociados.

    Flujo:
    1. Valida que el proyecto exista y que el archivo pertenezca a ese proyecto.
    2. Borra el archivo fisico en el blob storage local.
    3. Borra en Chroma los chunks del archivo para ese proyecto (source+doc_hash+case_id),
       solo si no quedan otras filas que referencien ese mismo contenido.
    4. Borra la fila `CaseFile`.
    """
    _get_case_or_404(db, case_id)
    case_file = _get_case_file_or_404(db, case_id, file_id)

    try:
        delete_case_file_blob(case_file.blob_path)
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=api_error_detail(
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                f"Fallo borrando el archivo fisico: {exc}",
                "storage_delete_failed",
            ),
        ) from exc

    shared_rows = (
        db.query(CaseFile)
        .filter(
            CaseFile.case_id == case_id,
            CaseFile.filename == case_file.filename,
            CaseFile.doc_hash == case_file.doc_hash,
            CaseFile.id != case_file.id,
        )
        .count()
    )

    if shared_rows == 0:
        try:
            collection = get_collection()
            scoped = collection.get(where={"case_id": case_id}, include=["metadatas"])
            ids = scoped.get("ids", []) or []
            metadatas = scoped.get("metadatas", []) or []

            ids_to_delete: list[str] = []
            for chunk_id, metadata in zip(ids, metadatas):
                if not metadata:
                    continue
                if metadata.get("source") == case_file.filename and metadata.get("doc_hash") == case_file.doc_hash:
                    ids_to_delete.append(chunk_id)

            if ids_to_delete:
                collection.delete(ids=ids_to_delete)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=api_error_detail(
                    status.HTTP_500_INTERNAL_SERVER_ERROR,
                    f"Fallo limpiando el indice vectorial: {exc}",
                    "vectorstore_delete_failed",
                ),
            ) from exc

    db.delete(case_file)
    db.commit()
