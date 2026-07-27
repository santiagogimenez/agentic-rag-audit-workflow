"""Endpoints for chats and their messages (spec-020, frontend React migration).

Reemplaza `cl.user_session["conversation_history"]` de la UI de Chainlit (memoria del proceso,
atada a un socket) por persistencia real: un frontend SPA sin estado necesita recargar el
historial desde `Message` antes de cada turno. `POST /{chat_id}/messages` es el único punto
de la API que escribe filas `Message` -- ninguna otra ruta debe persistir un turno (ver
`app/routers/tools.py` para la invocación explícita de tools, que persiste `ToolRun`, una tabla
distinta, nunca `Message`).

Nunca hay un `DELETE` sobre `Chat`/`Message`: son append-only, mismo espíritu que
`Finding`/`Report` (ver `.ai/guardrails/restricted-ops.json`).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.agentic_core.loop import run_agent_turn
from app.db import get_db
from app.deps import CurrentUser, get_current_user
from app.errors import api_error_detail
from app.models.audit_case import AuditCase
from app.models.chat import Chat
from app.models.message import Message
from app.schemas.chat import (
    ChatCreate,
    ChatOut,
    ChatPatch,
    ChatTurnRequest,
    ChatTurnResponse,
    MessageOut,
)

router = APIRouter(prefix="/api/chats", tags=["chats"])


def _get_chat_or_404(db: Session, chat_id: str) -> Chat:
    chat = db.get(Chat, chat_id)
    if chat is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=api_error_detail(status.HTTP_404_NOT_FOUND, "Chat not found", "chat_not_found"),
        )
    return chat


def _load_history(db: Session, chat_id: str) -> list[Message]:
    return (
        db.query(Message)
        .filter(Message.chat_id == chat_id)
        .order_by(Message.created_at.asc())
        .all()
    )


def _message_to_wire(m: Message) -> dict[str, Any]:
    """Reconstruye el dict wire (formato OpenAI/Groq) que espera `run_agent_turn` como
    `conversation_history`, a partir de la fila persistida. Ver docstring de
    `app/models/message.py`: para `role="tool"`, `content` es el string YA envuelto en
    `<untrusted_context>` -- se reproduce tal cual, nunca reconstruido desde `tool_output`.
    """
    if m.role == "user":
        return {"role": "user", "content": m.content}
    if m.role == "assistant":
        out: dict[str, Any] = {"role": "assistant", "content": m.content}
        if m.tool_calls:
            out["tool_calls"] = m.tool_calls
        return out
    return {"role": "tool", "tool_call_id": m.tool_call_id, "name": m.tool_name, "content": m.content}


@router.post("", response_model=ChatOut, status_code=status.HTTP_201_CREATED)
def create_chat(
    payload: ChatCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> Chat:
    """Crea un chat nuevo. `case_id=None` -> chat standalone (spec-020)."""
    if payload.case_id is not None and db.get(AuditCase, payload.case_id) is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=api_error_detail(
                status.HTTP_404_NOT_FOUND, "Audit case not found", "audit_case_not_found"
            ),
        )
    chat = Chat(case_id=payload.case_id, title=payload.title)
    db.add(chat)
    db.commit()
    db.refresh(chat)
    return chat


@router.get("", response_model=list[ChatOut])
def list_chats(
    case_id: str | None = None,
    standalone: bool = False,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[Chat]:
    """Lista chats, más recientes primero por actividad (`updated_at`).

    Sin filtro: todos los chats. `case_id=X`: solo los de ese proyecto. `standalone=true`
    (ignorado si se pasa `case_id`): solo chats sin proyecto (`case_id IS NULL`).
    """
    query = db.query(Chat)
    if case_id is not None:
        query = query.filter(Chat.case_id == case_id)
    elif standalone:
        query = query.filter(Chat.case_id.is_(None))
    return query.order_by(Chat.updated_at.desc()).offset(skip).limit(limit).all()


@router.get("/{chat_id}", response_model=ChatOut)
def get_chat(
    chat_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> Chat:
    return _get_chat_or_404(db, chat_id)


@router.patch("/{chat_id}", response_model=ChatOut)
def patch_chat(
    chat_id: str,
    payload: ChatPatch,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> Chat:
    """Único campo mutable de un chat: `title` (los mensajes son append-only, spec-020)."""
    chat = _get_chat_or_404(db, chat_id)
    chat.title = payload.title
    db.commit()
    db.refresh(chat)
    return chat


@router.delete("/{chat_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_chat(
    chat_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    """Elimina un chat y su transcript completo.

    Se usa para limpieza manual desde la UI (arranque de cero en desarrollo).
    """
    chat = _get_chat_or_404(db, chat_id)
    db.query(Message).filter(Message.chat_id == chat.id).delete(synchronize_session=False)
    db.delete(chat)
    db.commit()


@router.get("/{chat_id}/messages", response_model=list[MessageOut])
def list_messages(
    chat_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[Message]:
    """Transcript completo, ascendente -- para resumir un chat y para render en la UI."""
    _get_chat_or_404(db, chat_id)
    return _load_history(db, chat_id)


@router.post("/{chat_id}/messages", response_model=ChatTurnResponse, status_code=status.HTTP_201_CREATED)
async def post_chat_message(
    chat_id: str,
    payload: ChatTurnRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> ChatTurnResponse:
    """El endpoint de turno: carga el historial real, llama `run_agent_turn`, persiste SOLO el
    delta nuevo (nunca la lista completa -- `run_agent_turn` devuelve el historial entero, no
    incremental, ver `app/agentic_core/loop.py::run_agent_turn`) y actualiza `chat.updated_at`.
    """
    chat = _get_chat_or_404(db, chat_id)

    history_rows = _load_history(db, chat_id)
    conversation_history = [_message_to_wire(m) for m in history_rows]
    history_len_before = len(conversation_history)

    result = await run_agent_turn(payload.content, conversation_history, db, case_id=chat.case_id)

    delta = result.conversation_history[history_len_before:]
    tool_idx = 0
    persisted: list[Message] = []
    for wire in delta:
        if wire["role"] == "user":
            row = Message(chat_id=chat_id, role="user", content=wire.get("content"))
        elif wire["role"] == "assistant":
            row = Message(
                chat_id=chat_id,
                role="assistant",
                content=wire.get("content"),
                tool_calls=wire.get("tool_calls"),
            )
        else:  # role == "tool"
            record = result.tool_calls[tool_idx]
            tool_idx += 1
            report_id = None
            if record.tool_name == "generate_report" and "error" not in record.tool_output:
                report_id = record.tool_output.get("report_id")
            row = Message(
                chat_id=chat_id,
                role="tool",
                content=wire.get("content"),
                tool_call_id=wire.get("tool_call_id"),
                tool_name=record.tool_name,
                tool_input=record.tool_input,
                tool_output=record.tool_output,
                report_id=report_id,
            )
        db.add(row)
        persisted.append(row)

    if chat.title is None:
        chat.title = payload.content[:255]
    # Bump explícito: si `title` ya estaba seteado, no habría ningún cambio de columna que
    # dispare el `onupdate` de `Chat.updated_at` (app/models/chat.py) solo por postear mensajes.
    chat.updated_at = datetime.now(timezone.utc)
    db.commit()
    for row in persisted:
        db.refresh(row)

    return ChatTurnResponse(
        final_text=result.final_text,
        hit_max_iterations=result.hit_max_iterations,
        messages=[MessageOut.model_validate(row) for row in persisted],
    )
