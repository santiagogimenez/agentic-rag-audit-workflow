import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { addProjectSources, getProjectSources, removeProjectSource } from "@/lib/backend";

// Fuentes adjuntas a un proyecto: dropzone con drag&drop + selector nativo, lista con tamaño.
// Real contra `POST/GET/DELETE /api/audit-cases/{id}/files`: cada archivo se ingesta en Chroma
// taggeado con el `case_id` real -- buscable junto con la normativa general desde
// `search_evidence`, sin tool nueva.
export function SourcesPanel({ caseId }: { caseId: string }) {
  const queryClient = useQueryClient();
  const [dragOver, setDragOver] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sourcesQuery = useQuery({
    queryKey: ["project-sources", caseId],
    queryFn: () => getProjectSources(caseId),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["project-sources", caseId] });

  const addMutation = useMutation({
    mutationFn: (files: File[]) => addProjectSources(caseId, files),
    onSuccess: () => {
      setFeedback({ type: "success", text: "Fuentes cargadas correctamente." });
      invalidate();
    },
    onError: (error: unknown) => {
      const text = error instanceof Error ? error.message : "No se pudieron cargar las fuentes.";
      setFeedback({ type: "error", text });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (fileId: string) => removeProjectSource(caseId, fileId),
    onSuccess: () => {
      setFeedback({ type: "success", text: "Fuente eliminada correctamente." });
      invalidate();
    },
    onError: (error: unknown) => {
      const text = error instanceof Error ? error.message : "No se pudo eliminar la fuente.";
      setFeedback({ type: "error", text });
    },
  });

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setFeedback(null);
    addMutation.mutate(Array.from(fileList));
  };

  const handleDelete = (fileId: string, fileName: string) => {
    const accepted = window.confirm(`Eliminar la fuente \"${fileName}\"? Esta accion no se puede deshacer.`);
    if (!accepted) {
      setFeedback({ type: "success", text: "Eliminacion cancelada." });
      return;
    }
    setFeedback(null);
    removeMutation.mutate(fileId);
  };

  const sources = sourcesQuery.data ?? [];

  return (
    <div>
      {feedback && (
        <div
          className={`mb-3 rounded border px-3 py-2 text-xs ${
            feedback.type === "success"
              ? "border-verdigris/40 bg-verdigris-tint text-verdigris"
              : "border-flag/40 bg-flag-tint text-flag"
          }`}
        >
          {feedback.text}
        </div>
      )}
      <div
        onClick={() => fileInputRef.current?.click()}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={`mb-3.5 cursor-pointer rounded border-[1.5px] border-dashed p-6.5 text-center text-xs transition-colors ${
          dragOver ? "border-accent bg-accent-tint text-text" : "border-border text-text-faint"
        }`}
      >
        Arrastrá archivos aquí o{" "}
        <span className="font-semibold text-accent underline">elegí desde tu equipo</span>
        <br />
        PDF, DOCX, XLSX, MD — buscables junto con la normativa general.
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {sources.length === 0 ? (
        <div className="p-6.5 text-center text-xs text-text-faint">Sin fuentes adjuntas todavía.</div>
      ) : (
        <div className="flex flex-col">
          {sources.map((file) => (
            <div key={file.id} className="flex items-center gap-3 rounded px-2.5 py-2.5 hover:bg-bg-raised">
              <span className="text-text-faint">📄</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-medium">{file.name}</div>
                <div className="text-[11.5px] text-text-faint">{file.sizeLabel}</div>
              </div>
              <button
                className="rounded border border-border px-2 py-1 text-[11px] text-text-dim hover:border-flag hover:text-flag"
                onClick={() => handleDelete(file.id, file.name)}
                disabled={removeMutation.isPending}
                title="Eliminar fuente"
              >
                Eliminar
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
