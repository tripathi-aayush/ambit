"use client";

import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";
import { chat, getRepo, type ChatMessage, type ChatSource, type Repository } from "@/lib/api";

interface DisplayMessage extends ChatMessage {
  sources?: ChatSource[];
  notEnoughInfo?: boolean;
}

const KIND_LABELS: Record<string, string> = {
  code: "Code",
  commit: "Commit",
  pr: "Pull Request",
  issue: "Issue",
};

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
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const question = input.trim();
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

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-8">
      <header className="mb-4 flex items-center justify-between border-b border-neutral-200 pb-4">
        <div>
          <Link href="/" className="text-xs text-neutral-500 hover:underline">
            ← All repositories
          </Link>
          <h1 className="text-lg font-semibold">{repo?.name ?? "…"}</h1>
          <nav className="mt-2 flex gap-4 text-sm">
            <span className="font-medium text-neutral-900">Chat</span>
            <Link href={`/repos/${id}/architecture`} className="text-neutral-500 hover:underline">
              Architecture
            </Link>
          </nav>
        </div>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto pb-4">
        {messages.length === 0 && (
          <p className="text-sm text-neutral-500">
            Ask something about this repository — its code, commit history, or issues/PRs.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
            <div
              className={`inline-block max-w-[85%] rounded-lg px-4 py-2 text-sm ${
                m.role === "user" ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-900"
              }`}
            >
              <p className="whitespace-pre-wrap">{m.content}</p>
            </div>
            {m.sources && m.sources.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2 text-left">
                {m.sources.map((s, si) => (
                  <div
                    key={si}
                    title={s.content}
                    className="max-w-xs rounded border border-neutral-200 px-2 py-1 text-xs text-neutral-600"
                  >
                    <span className="font-medium">
                      [{si + 1}] {KIND_LABELS[s.kind] ?? s.kind}
                    </span>{" "}
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noreferrer" className="hover:underline">
                        {s.label}
                      </a>
                    ) : (
                      <span>{s.label}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {sending && <p className="text-sm text-neutral-400">Thinking…</p>}
        <div ref={bottomRef} />
      </div>

      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

      <form onSubmit={handleSubmit} className="flex gap-2 border-t border-neutral-200 pt-4">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about this repository…"
          className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
        <button
          type="submit"
          disabled={sending}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
