import { FileEdit, FileX2, GitCommitHorizontal, GitBranch, SquareTerminal, Database, type LucideIcon } from "lucide-react";

// Shared action_type -> icon/label so Tasks (DAG, approval cards) and
// Timeline (audit rows) agree on the same glyph for the same action type.
export const ACTION_TYPE_META: Record<string, { label: string; icon: LucideIcon }> = {
  file_write: { label: "Write file", icon: FileEdit },
  file_delete: { label: "Delete file", icon: FileX2 },
  git_commit: { label: "Commit", icon: GitCommitHorizontal },
  git_push: { label: "Push", icon: GitBranch },
  shell_exec: { label: "Run command", icon: SquareTerminal },
  db_migration: { label: "Database migration", icon: Database },
};

export function actionTypeMeta(actionType: string) {
  return ACTION_TYPE_META[actionType] ?? { label: actionType, icon: FileEdit };
}
