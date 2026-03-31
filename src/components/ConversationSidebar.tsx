import { Download, MessageSquare, Plus, Trash2, X } from "lucide-react";

interface StoredConversation {
  id: string;
  title: string;
  messages: { id: string; role: string; content: string }[];
  updatedAt: string;
}

interface ConversationSidebarProps {
  open: boolean;
  conversations: StoredConversation[];
  activeId: string;
  darkMode: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onExport: (id: string) => void;
  onClose: () => void;
}

export default function ConversationSidebar({
  open,
  conversations,
  activeId,
  darkMode,
  onSelect,
  onNew,
  onDelete,
  onExport,
  onClose,
}: ConversationSidebarProps) {
  return (
    <div
      className={`shrink-0 flex flex-col border-r transition-all duration-300 overflow-hidden ${
        open ? "w-64" : "w-0 border-r-0"
      } ${darkMode ? "border-gray-700 bg-gray-800" : "border-slate-200 bg-slate-50"}`}
    >
      <div className={`flex items-center justify-between px-4 py-3 ${darkMode ? "border-gray-700" : "border-slate-200"} border-b`}>
        <h3 className={`text-sm font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>Conversas</h3>
        <div className="flex gap-1">
          <button
            onClick={onNew}
            className={`rounded-md p-1.5 transition-colors ${darkMode ? "hover:bg-gray-700 text-gray-400" : "hover:bg-slate-200 text-slate-500"}`}
            title="Nova conversa"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            onClick={onClose}
            className={`rounded-md p-1.5 transition-colors ${darkMode ? "hover:bg-gray-700 text-gray-400" : "hover:bg-slate-200 text-slate-500"}`}
            title="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-2">
        {conversations.length === 0 ? (
          <p className={`px-2 py-4 text-center text-xs ${darkMode ? "text-gray-500" : "text-slate-400"}`}>
            Nenhuma conversa ainda
          </p>
        ) : (
          conversations.map((conv) => (
            <div
              key={conv.id}
              className={`group mb-1 flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer transition-colors ${
                conv.id === activeId
                  ? darkMode
                    ? "bg-gray-700 text-white"
                    : "bg-blue-50 text-blue-700"
                  : darkMode
                    ? "text-gray-300 hover:bg-gray-700/50"
                    : "text-slate-600 hover:bg-slate-100"
              }`}
              onClick={() => onSelect(conv.id)}
            >
              <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-50" />
              <span className="flex-1 truncate text-xs font-medium">{conv.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onExport(conv.id);
                }}
                className={`hidden rounded p-0.5 transition-colors group-hover:block ${
                  darkMode ? "hover:bg-blue-500/20 text-gray-500 hover:text-blue-400" : "hover:bg-blue-50 text-slate-400 hover:text-blue-500"
                }`}
                title="Exportar"
              >
                <Download className="h-3 w-3" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(conv.id);
                }}
                className={`hidden rounded p-0.5 transition-colors group-hover:block ${
                  darkMode ? "hover:bg-red-500/20 text-gray-500 hover:text-red-400" : "hover:bg-red-50 text-slate-400 hover:text-red-500"
                }`}
                title="Excluir"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
