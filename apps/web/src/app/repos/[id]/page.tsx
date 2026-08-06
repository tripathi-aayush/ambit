"use client";

import { use, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { FileCode2, GitCommitHorizontal, GitPullRequest, MessageCircle, CircleAlert } from "lucide-react";
import { RepoNav } from "@/components/RepoNav";
import { markdownComponents } from "@/components/markdownComponents";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { chat, getRepo, type ChatMessage, type ChatSource, type Repository } from "@/lib/api";

interface DisplayMessage extends ChatMessage {
  sources?: ChatSource[];
  notEnoughInfo?: boolean;
}

const KIND_META: Record<string, { label: string; icon: typeof FileCode2 }> = {
  code: { label: "Code", icon: FileCode2 },
  commit: { label: "Commit", icon: GitCommitHorizontal },
  pr: { label: "Pull Request", icon: GitPullRequest },
  issue: { label: "Issue", icon: CircleAlert },
};

function suggestedQuestions(repo: Repository | null): string[] {
  const framework = repo?.frameworks[0];
  return [
    "What does this repository do?",
    framework ? `How is ${framework} used in this codebase?` : "What are the main components?",
    "What's the riskiest part of this codebase to change?",
    "What tests exist for this repo?",
  ];
}

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-1 py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-300 dark:bg-neutral-600"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </div>
  );
}

export default function RepoChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [repo, setRepo] = useState<Repository | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getRepo(id).then(setRepo).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const sendMessage = async (question: string) => {
    if (!question || sending) return;

    const nextMessages: DisplayMessage[] = [...messages, { role: "user", content: question }];
    setMessages(nextMessages);
    setInput("");
    setSending(true);
    setError(null);

    try {
      const res = await chat(
        id,
        nextMessages.map(({ role, content }) => ({ role, content }))
      );
      setMessages([
        ...nextMessages,
        {
          role: "assistant",
          content: res.answer,
          sources: res.sources,
          notEnoughInfo: res.not_enough_information,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input.trim());
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-8">
      <PageHeader backHref="/repos" title={repo?.name ?? "…"} tabs={<RepoNav repoId={id} active="chat" />} />

      <div className="flex-1 space-y-6 overflow-y-auto pb-4">
        {messages.length === 0 && (
          <div>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Ask something about this repository — its code, commit history, or issues/PRs.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {suggestedQuestions(repo).map((q) => (
                <button
                  key={q}
                  onClick={() => sendMessage(q)}
                  className="rounded-full border border-neutral-200 px-3 py-1.5 text-xs text-neutral-600 transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:border-neutral-800 dark:text-neutral-400"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className="flex gap-3">
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
              <MessageCircle className="h-3.5 w-3.5" strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="mb-1 text-xs font-medium text-neutral-400 dark:text-neutral-500">{m.role === "user" ? "You" : "Orion"}</p>
              {m.role === "user" ? (
                <p className="max-w-[65ch] whitespace-pre-wrap text-sm leading-relaxed text-neutral-900 dark:text-neutral-100">
                  {m.content}
                </p>
              ) : (
                <div className="text-sm">
                  <ReactMarkdown components={markdownComponents}>{m.content}</ReactMarkdown>
                </div>
              )}
              {m.sources && m.sources.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {m.sources.map((s, si) => {
                    const meta = KIND_META[s.kind] ?? { label: s.kind, icon: FileCode2 };
                    const Icon = meta.icon;
                    return (
                      <div
                        key={si}
                        title={s.content}
                        className="flex max-w-xs items-center gap-1.5 rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-600 dark:border-neutral-800 dark:text-neutral-400"
                      >
                        <Icon className="h-3 w-3 shrink-0 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
                        <span className="font-medium text-neutral-500 dark:text-neutral-400">[{si + 1}]</span>
                        {s.url ? (
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noreferrer"
                            className="truncate rounded hover:text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          >
                            {s.label}
                          </a>
                        ) : (
                          <span className="truncate">{s.label}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex gap-3">
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
              <MessageCircle className="h-3.5 w-3.5" strokeWidth={2} />
            </div>
            <ThinkingIndicator />
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <div className="mb-2">
          <ErrorMessage>{error}</ErrorMessage>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2 border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about this repository…"
          className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent dark:border-neutral-700 dark:bg-neutral-900"
        />
        <Button type="submit" loading={sending}>
          Send
        </Button>
      </form>
    </div>
  );
}
