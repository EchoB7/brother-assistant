import { Compass, Lightbulb, Sparkles, BookOpen, type LucideIcon } from "lucide-react";

interface PromptCardProps {
  icon: LucideIcon;
  text: string;
  onClick: () => void;
  gradient: string;
}

function PromptCard({ icon: Icon, text, onClick, gradient }: PromptCardProps) {
  return (
    <button
      onClick={onClick}
      className="relative flex items-start gap-3 p-4 rounded-2xl bg-white dark:bg-gray-800 border-2 border-slate-100 dark:border-gray-700 hover:border-transparent hover:shadow-xl transition-all duration-300 text-left group overflow-hidden w-full"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-950/30 dark:to-purple-950/30 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
      <div className={`relative w-10 h-10 bg-gradient-to-br ${gradient} rounded-xl flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-300 shrink-0`}>
        <Icon className="w-5 h-5 text-white" strokeWidth={2.5} />
      </div>
      <p className="relative text-sm text-slate-700 dark:text-gray-300 group-hover:text-slate-900 dark:group-hover:text-white font-medium leading-relaxed pt-1">
        {text}
      </p>
    </button>
  );
}

interface QuickActionsProps {
  onAction: (action: string) => void;
}

const prompts = [
  { icon: Compass, text: "Onde as pessoas viajam para experiências culinárias?", gradient: "from-blue-500 to-cyan-500" },
  { icon: Lightbulb, text: "Me ajude a entender computação quântica", gradient: "from-amber-500 to-orange-500" },
  { icon: Sparkles, text: "Estou procurando móveis artesanais para meu apartamento", gradient: "from-purple-500 to-pink-500" },
  { icon: BookOpen, text: "Crie um plano de refeições para as próximas duas semanas", gradient: "from-green-500 to-emerald-500" },
];

export default function QuickActions({ onAction }: QuickActionsProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto p-5">
      <div className="py-6 text-center">
        <div className="relative inline-block">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 rounded-3xl blur-xl opacity-30 animate-pulse" />
          <div className="relative w-16 h-16 bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 rounded-3xl flex items-center justify-center shadow-2xl">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
        </div>
        <h3 className="mt-4 text-lg font-bold text-slate-900 dark:text-white">Como posso ajudar você hoje?</h3>
        <p className="mt-1 text-xs font-medium text-slate-500 dark:text-gray-400">Pergunte qualquer coisa ou experimente estas sugestões</p>
      </div>

      <div className="mt-4 flex w-full max-w-sm flex-col gap-3">
        {prompts.map((p) => (
          <PromptCard
            key={p.text}
            icon={p.icon}
            text={p.text}
            onClick={() => onAction(p.text)}
            gradient={p.gradient}
          />
        ))}
      </div>

      <div className="mt-6 w-full max-w-sm rounded-2xl border border-blue-100 dark:border-blue-900/50 bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-950/30 dark:to-purple-950/30 p-4">
        <p className="text-[11px] text-slate-600 dark:text-gray-400 leading-relaxed">
          <span className="font-semibold">Nota:</span> Brother usa IA. As respostas podem conter erros — sempre verifique informações importantes.
        </p>
      </div>
    </div>
  );
}
