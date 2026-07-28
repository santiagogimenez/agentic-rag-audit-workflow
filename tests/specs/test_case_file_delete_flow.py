from __future__ import annotations

from app.models.audit_case import AuditCase
from app.models.case_file import CaseFile


class _FakeCollection:
    def __init__(self, ids: list[str] | None = None, metadatas: list[dict] | None = None) -> None:
        self.delete_calls: list[dict] = []
        self._ids = ids or []
        self._metadatas = metadatas or []

    def get(self, **_kwargs):
        return {"ids": self._ids, "metadatas": self._metadatas}

    def delete(self, **kwargs):
        self.delete_calls.append(kwargs)


def test_delete_case_file_removes_row_and_vector_chunks(client, db_session, monkeypatch):
    case = AuditCase(id="case-1", name="Proyecto 1")
    db_session.add(case)
    db_session.commit()

    case_file = CaseFile(
        id="file-1",
        case_id=case.id,
        filename="evidencia.md",
        size_bytes=10,
        doc_hash="hash-1",
        blob_path="case-1/file-1.md",
        chunks_indexed=2,
    )
    db_session.add(case_file)
    db_session.commit()

    storage_calls: list[str] = []
    fake_collection = _FakeCollection(
        ids=["chunk-1", "chunk-2"],
        metadatas=[
            {"source": "evidencia.md", "doc_hash": "hash-1"},
            {"source": "otra.md", "doc_hash": "hash-2"},
        ],
    )

    monkeypatch.setattr(
        "app.routers.case_files.delete_case_file_blob",
        lambda blob_path: storage_calls.append(blob_path) or True,
    )
    monkeypatch.setattr("app.routers.case_files.get_collection", lambda: fake_collection)

    response = client.delete(f"/api/audit-cases/{case.id}/files/{case_file.id}")

    assert response.status_code == 204
    assert storage_calls == ["case-1/file-1.md"]
    assert fake_collection.delete_calls == [
        {
            "ids": ["chunk-1"]
        }
    ]
    assert db_session.get(CaseFile, case_file.id) is None


def test_delete_case_file_returns_404_when_file_not_found(client, db_session):
    case = AuditCase(id="case-2", name="Proyecto 2")
    db_session.add(case)
    db_session.commit()

    response = client.delete(f"/api/audit-cases/{case.id}/files/missing-file")

    assert response.status_code == 404
    body = response.json()
    assert body["code"] == "case_file_not_found"


def test_delete_case_file_returns_404_when_file_belongs_to_other_case(client, db_session):
    case_a = AuditCase(id="case-a", name="Proyecto A")
    case_b = AuditCase(id="case-b", name="Proyecto B")
    db_session.add_all([case_a, case_b])
    db_session.commit()

    file_b = CaseFile(
        id="file-b",
        case_id=case_b.id,
        filename="otra_fuente.md",
        size_bytes=10,
        doc_hash="hash-b",
        blob_path="case-b/file-b.md",
        chunks_indexed=1,
    )
    db_session.add(file_b)
    db_session.commit()

    response = client.delete(f"/api/audit-cases/{case_a.id}/files/{file_b.id}")

    assert response.status_code == 404
    body = response.json()
    assert body["code"] == "case_file_not_found"


def test_delete_case_file_skips_chroma_delete_when_chunks_are_shared(client, db_session, monkeypatch):
    case = AuditCase(id="case-3", name="Proyecto 3")
    db_session.add(case)
    db_session.commit()

    file_a = CaseFile(
        id="file-a",
        case_id=case.id,
        filename="fuente.md",
        size_bytes=10,
        doc_hash="same-hash",
        blob_path="case-3/file-a.md",
        chunks_indexed=2,
    )
    file_b = CaseFile(
        id="file-b",
        case_id=case.id,
        filename="fuente.md",
        size_bytes=10,
        doc_hash="same-hash",
        blob_path="case-3/file-b.md",
        chunks_indexed=0,
    )
    db_session.add_all([file_a, file_b])
    db_session.commit()

    fake_collection = _FakeCollection(
        ids=["chunk-1"],
        metadatas=[{"source": "fuente.md", "doc_hash": "same-hash"}],
    )
    monkeypatch.setattr("app.routers.case_files.delete_case_file_blob", lambda _blob: True)
    monkeypatch.setattr("app.routers.case_files.get_collection", lambda: fake_collection)

    response = client.delete(f"/api/audit-cases/{case.id}/files/{file_a.id}")

    assert response.status_code == 204
    assert fake_collection.delete_calls == []
    assert db_session.get(CaseFile, file_a.id) is None
    assert db_session.get(CaseFile, file_b.id) is not None
