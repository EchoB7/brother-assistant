interface SidebarProps {
  conversations: string[];
  activeIndex: number;
  onSelectConversation: (index: number) => void;
  onNewConversation: () => void;
  backendStatus: "online" | "offline" | "checking";
}

export default function Sidebar({
  conversations,
  activeIndex,
  onSelectConversation,
  onNewConversation,
  backendStatus,
}: SidebarProps) {
  const dotClass =
    backendStatus === "online"
      ? "sidebar__statusDot"
      : backendStatus === "checking"
        ? "sidebar__statusDot sidebar__statusDot--checking"
        : "sidebar__statusDot sidebar__statusDot--offline";

  const statusText =
    backendStatus === "online"
      ? "Conectado"
      : backendStatus === "checking"
        ? "Verificando..."
        : "Offline";

  return (
    <aside className="sidebar">
      <div className="sidebar__header">
        <div className="sidebar__logo">
          <div className="sidebar__logoIcon">✦</div>
          <span className="sidebar__logoText">Brother</span>
        </div>
        <button className="sidebar__newChat" onClick={onNewConversation}>
          ＋ Nova conversa
        </button>
      </div>

      <div className="sidebar__conversations">
        <p className="sidebar__sectionLabel">Conversas</p>
        <div className="sidebar__convList">
          {conversations.map((conversation, index) => (
            <button
              className={
                index === activeIndex
                  ? "sidebar__convItem active"
                  : "sidebar__convItem"
              }
              key={index}
              onClick={() => onSelectConversation(index)}
            >
              💬 {conversation}
            </button>
          ))}
        </div>
      </div>

      <div className="sidebar__status">
        <span className={dotClass} />
        {statusText}
      </div>
    </aside>
  );
}
