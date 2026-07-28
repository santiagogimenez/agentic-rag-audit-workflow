import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { deleteChat, deleteProject, getChats, getProjects, getToolCatalog } from "@/lib/backend";
import { NewProjectModal } from "@/components/projects/NewProjectModal";

// Primer corte de la Sidebar (tarea 1d/2b del plan): estructura + navegación real contra los
// datos mock. El diseño visual (paleta, tipografía, spacing) está portado 1:1 del mockup vía
// los tokens de tailwind.config.js.
export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: getProjects });
  const toolsQuery = useQuery({ queryKey: ["tools"], queryFn: getToolCatalog });
  const standaloneChatsQuery = useQuery({
    queryKey: ["chats", { standalone: true }],
    queryFn: () => getChats({ standalone: true }),
  });

  const deleteProjectMutation = useMutation({
    mutationFn: deleteProject,
    onSuccess: (_, projectId) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["chats"] });
      if (location.pathname.startsWith(`/projects/${projectId}`)) {
        navigate("/");
      }
    },
  });

  const deleteChatMutation = useMutation({
    mutationFn: deleteChat,
    onSuccess: (_, chatId) => {
      queryClient.invalidateQueries({ queryKey: ["chats"] });
      if (location.pathname === `/chats/${chatId}`) {
        navigate("/");
      }
    },
  });

  return (
    <>
    <aside
      className={`flex flex-shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar-bg transition-[width] duration-200 ${
        collapsed ? "w-[60px]" : "w-[276px]"
      }`}
    >
      <div className="flex flex-shrink-0 items-center gap-2 px-2.5 py-3.5">
        <button
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-sm text-text-dim hover:bg-bg-sunken hover:text-text"
          aria-label="Contraer/expandir sidebar"
          onClick={() => setCollapsed((c) => !c)}
        >
          <MenuIcon />
        </button>
        {!collapsed && (
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
            <div className="flex h-6.5 w-6.5 flex-shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-accent to-verdigris text-[13px] font-extrabold text-[#14110a]">
              A
            </div>
            <div className="truncate text-[14.5px] font-semibold">Agentic Audit RAG Workflow</div>
          </div>
        )}
      </div>

      <div className="flex-shrink-0 px-2.5 pb-2.5">
        <Link
          to="/"
          className={`flex w-full items-center gap-2.5 rounded border border-border bg-bg-raised px-2.5 py-2 text-[13px] font-medium hover:border-accent hover:bg-accent-tint ${
            collapsed ? "justify-center px-0" : ""
          }`}
        >
          <EditIcon />
          {!collapsed && <span className="whitespace-nowrap">Nuevo chat</span>}
        </Link>
      </div>

      <nav className="scrollbar-thin flex flex-1 flex-col gap-4.5 overflow-y-auto px-2 pb-2">
        <div>
          {!collapsed && (
            <div className="flex items-center justify-between px-1.5 pb-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-text-faint">
                Proyectos
              </span>
              <button
                className="flex h-5 w-5 items-center justify-center rounded text-text-faint hover:bg-bg-sunken hover:text-accent"
                title="Nuevo proyecto"
                onClick={() => setShowNewProject(true)}
              >
                <PlusIcon />
              </button>
            </div>
          )}
          {!collapsed &&
            projectsQuery.data?.map((project) => {
              const active = location.pathname.startsWith(`/projects/${project.id}`);
              return (
                <div
                  key={project.id}
                  className={`group flex items-center gap-1 rounded-sm border-l-2 pr-1 ${
                    active
                      ? "border-accent bg-accent-tint text-text"
                      : "border-transparent text-text-dim hover:bg-bg-sunken hover:text-text"
                  }`}
                >
                  <Link
                    to={`/projects/${project.id}`}
                    className="flex min-w-0 flex-1 items-center gap-2 truncate px-2 py-1.5 text-[13px]"
                    title={project.name}
                  >
                    <FolderIcon className={active ? "text-accent" : "text-text-faint"} />
                    <span className="truncate">{project.name}</span>
                  </Link>
                  <button
                    className="hidden h-6 w-6 flex-shrink-0 items-center justify-center rounded text-text-faint hover:bg-bg-sunken hover:text-danger group-hover:flex"
                    title="Eliminar proyecto"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (confirm(`Eliminar proyecto "${project.name}" y sus chats/reportes/hallazgos?`)) {
                        deleteProjectMutation.mutate(project.id);
                      }
                    }}
                  >
                    <TrashIcon />
                  </button>
                </div>
              );
            })}
        </div>

        {!collapsed && (
          <div>
            <div className="px-1.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-faint">
              Herramientas
            </div>
            <Link
              to="/tools"
              className={`flex items-center gap-2 rounded-sm border-l-2 px-2 py-1.5 text-[13px] ${
                location.pathname === "/tools"
                  ? "border-accent bg-accent-tint text-text"
                  : "border-transparent text-text-dim hover:bg-bg-sunken hover:text-text"
              }`}
            >
              <SlidersIcon />
              <span>
                Catálogo de herramientas
                {toolsQuery.data ? ` (${toolsQuery.data.filter((t) => t.installed).length})` : ""}
              </span>
            </Link>
          </div>
        )}

        {!collapsed && !!standaloneChatsQuery.data?.length && (
          <div>
            <div className="px-1.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-faint">
              Recientes
            </div>
            {standaloneChatsQuery.data.map((chat) => (
              <div
                key={chat.id}
                className={`group flex items-center gap-1 rounded-sm border-l-2 pr-1 ${
                  location.pathname === `/chats/${chat.id}`
                    ? "border-accent bg-accent-tint text-text"
                    : "border-transparent text-text-dim hover:bg-bg-sunken hover:text-text"
                }`}
              >
                <Link
                  to={`/chats/${chat.id}`}
                  className="flex min-w-0 flex-1 items-center gap-2 truncate px-2 py-1.5 text-[13px]"
                >
                  <ChatIcon className="text-text-faint" />
                  <span className="truncate">{chat.title ?? "Nuevo chat"}</span>
                </Link>
                <button
                  className="hidden h-6 w-6 flex-shrink-0 items-center justify-center rounded text-text-faint hover:bg-bg-sunken hover:text-danger group-hover:flex"
                  title="Eliminar chat"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (confirm("Eliminar este chat?")) {
                      deleteChatMutation.mutate(chat.id);
                    }
                  }}
                >
                  <TrashIcon />
                </button>
              </div>
            ))}
          </div>
        )}
      </nav>

      <div className="flex flex-shrink-0 items-center gap-2.5 border-t border-sidebar-border p-2.5">
        <div className="flex h-6.5 w-6.5 flex-shrink-0 items-center justify-center rounded-full bg-verdigris text-[11.5px] font-bold text-[#eafff9]">
          AA
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="truncate text-[12.5px] font-semibold">Alejandro Ávila</div>
            <div className="truncate text-[11px] text-text-faint">Auditor · dev-user-0</div>
          </div>
        )}
      </div>
    </aside>
    {showNewProject && <NewProjectModal onClose={() => setShowNewProject(false)} />}
    </>
  );
}

function MenuIcon() {
  return (
    <svg className="h-[17px] w-[17px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  );
}
function EditIcon() {
  return (
    <svg className="h-[17px] w-[17px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function FolderIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={`h-[17px] w-[17px] flex-shrink-0 ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  );
}
function SlidersIcon() {
  return (
    <svg className="h-[17px] w-[17px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <path d="M5 21V10M5 6V3M12 21v-7M12 10V3M19 21v-4M19 13V3" />
      <circle cx="5" cy="8" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="15" r="2" />
    </svg>
  );
}
function ChatIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={`h-[17px] w-[17px] flex-shrink-0 ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.5 8.5 0 1 1-3.8-7.1L21 3l-1 4.3a8.4 8.4 0 0 1 1 4.2Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="h-[14px] w-[14px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}
