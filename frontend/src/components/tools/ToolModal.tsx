import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { createTool, updateTool } from "@/lib/backend";
import { Modal } from "@/components/Modal";
import type { ToolAction, ToolCatalogEntry, ToolKind } from "@/types/domain";

let draftActionUid = 0;
const nextActionId = () => `draft_act_${++draftActionUid}`;

interface ToolModalProps {
  existing: ToolCatalogEntry | null;
  onClose: () => void;
}

// Alta/edición de una herramienta del catálogo global: nombre, identificador técnico,
// descripción, tipo, y la lista de acciones que expone -- cada acción con el comando/endpoint
// real que ejecuta detrás (texto libre: soporta `POST /api/...`, `python -m app.tools....`, o
// un comando de shell). Ver mockup (sidebar-mockup.html) -- esta es la versión React 1:1.
export function ToolModal({ existing, onClose }: ToolModalProps) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState(existing?.label ?? "");
  const [key, setKey] = useState(existing?.key ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [kind, setKind] = useState<ToolKind>(existing?.kind ?? "write");
  const [actions, setActions] = useState<ToolAction[]>(
    existing?.actions.map((a) => ({ ...a })) ?? [{ id: nextActionId(), label: "", command: "" }],
  );

  const mutation = useMutation({
    mutationFn: async () => {
      const clean = actions.filter((a) => a.label.trim() && a.command.trim());
      if (existing) return updateTool(existing.key, { label: label.trim(), description: description.trim(), kind, actions: clean });
      return createTool({ label: label.trim(), key, description: description.trim(), kind, actions: clean });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tools"] });
      onClose();
    },
  });

  const canSubmit = label.trim().length > 0 && actions.some((a) => a.label.trim() && a.command.trim());

  const updateAction = (id: string, patch: Partial<ToolAction>) => {
    setActions((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  };
  const removeAction = (id: string) => {
    setActions((prev) => (prev.length <= 1 ? prev : prev.filter((a) => a.id !== id)));
  };

  return (
    <Modal
      title={existing ? "Editar herramienta" : "Nueva herramienta"}
      onClose={onClose}
      footer={
        <>
          <button className="rounded px-3.5 py-2 text-[13px] font-medium hover:bg-bg-sunken" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="rounded border border-accent bg-accent px-3.5 py-2 text-[13px] font-semibold text-[#1c1508] disabled:opacity-40"
            disabled={!canSubmit || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {existing ? "Guardar cambios" : "Instalar herramienta"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Nombre">
          <input
            className="w-full rounded-sm border border-border bg-bg-sunken px-2.5 py-2 text-sm outline-none focus:border-accent"
            placeholder="p. ej. Consultar SAP GRC"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>
        <Field label="Identificador técnico" help={existing ? "No se puede cambiar una vez instalada." : "Se genera del nombre si lo dejás vacío."}>
          <input
            className="w-full rounded-sm border border-border bg-bg-sunken px-2.5 py-2 text-sm outline-none focus:border-accent disabled:opacity-60"
            value={key}
            disabled={!!existing}
            onChange={(e) => setKey(e.target.value)}
          />
        </Field>
        <Field label="Descripción">
          <textarea
            className="min-h-20 w-full rounded-sm border border-border bg-bg-sunken px-2.5 py-2 text-sm outline-none focus:border-accent"
            placeholder="Qué hace esta herramienta y cuándo conviene usarla."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <Field label="Tipo">
          <div className="flex gap-1.5">
            {(["ro", "write"] as ToolKind[]).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`flex-1 rounded-sm border px-2 py-2 text-xs font-semibold ${
                  kind === k ? "border-accent bg-accent-tint" : "border-border bg-bg-sunken text-text-dim"
                }`}
              >
                {k === "ro" ? "Solo lectura" : "Escribe / muta datos"}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Acciones y comandos" help="Cada acción es algo puntual que la herramienta puede hacer. El comando es lo que se ejecuta detrás.">
          <div className="flex flex-col gap-2.5">
            {actions.map((action) => (
              <div key={action.id} className="flex items-start gap-2">
                <input
                  className="flex-1 rounded-sm border border-border bg-bg-sunken px-2.5 py-2 text-sm outline-none focus:border-accent"
                  placeholder='Nombre de la acción (p. ej. "Consultar hallazgos abiertos")'
                  value={action.label}
                  onChange={(e) => updateAction(action.id, { label: e.target.value })}
                />
                <input
                  className="flex-[1.2] rounded-sm border border-border bg-bg-sunken px-2.5 py-2 font-mono text-xs outline-none focus:border-accent"
                  placeholder="Comando / endpoint (p. ej. GET /api/grc/findings)"
                  value={action.command}
                  onChange={(e) => updateAction(action.id, { command: e.target.value })}
                />
                <button
                  className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded text-text-dim hover:bg-bg-sunken hover:text-flag"
                  onClick={() => removeAction(action.id)}
                >
                  🗑
                </button>
              </div>
            ))}
            <button
              className="self-start rounded border border-border px-2.5 py-1.5 text-xs font-semibold hover:border-accent"
              onClick={() => setActions((prev) => [...prev, { id: nextActionId(), label: "", command: "" }])}
            >
              + Agregar acción
            </button>
          </div>
        </Field>
      </div>
    </Modal>
  );
}

function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold text-text-dim">{label}</label>
      {children}
      {help && <div className="text-[11.5px] text-text-faint">{help}</div>}
    </div>
  );
}
