package ambit

# Rego v1 syntax (default as of OPA 1.0). Input is the Action Object as
# submitted to POST /actions (see packages/shared/action-object.schema.json).

default allow := true

default require_approval := false

deny_reasons contains reason if {
	input.action_type == "git_commit"
	input.branch in {"main", "master"}
	reason := "direct commits to main/master are not allowed; use a pull request"
}

allow := false if count(deny_reasons) > 0

approval_reasons contains reason if {
	input.action_type == "db_migration"
	input.environment == "prod"
	reason := "production database migrations require human approval"
}

approval_reasons contains reason if {
	input.action_type == "shell_exec"
	input.environment == "prod"
	reason := "shell execution in production requires human approval"
}

approval_reasons contains reason if {
	input.action_type == "git_push"
	input.branch in {"main", "master"}
	reason := "pushes to a protected branch require human approval"
}

# Sprint 1 / audit C4: file_write and file_delete previously had no rules
# at all here, so they never required approval regardless of what path
# they touched or what environment they ran in -- the risk score alone
# (app/risk.py) was the only gate, and it can under-score real cases (a
# sensitive-path write in dev scores "low"). These two rules close that.
#
# Patterns mirror app/risk.py's SENSITIVE_TARGET_PATTERNS -- the two lists
# aren't automatically kept in sync (same class of drift risk flagged for
# packages/shared in the audit's M1), but duplicating a short, rarely-
# changed list here is a deliberately small fix, not a shared-config
# system. Revisit if this list needs to grow much further.
sensitive_path_patterns := [
	`(?i)\.env(\.|$)`,
	`(?i)secrets?[/.]`,
	`(?i)credentials?`,
	`(?i)\.pem$`,
	`(?i)id_rsa`,
	`(?i)config/production`,
]

is_sensitive_path(path) if {
	some pattern in sensitive_path_patterns
	regex.match(pattern, path)
}

approval_reasons contains reason if {
	input.action_type in {"file_write", "file_delete"}
	is_sensitive_path(input.target)
	reason := sprintf("%s targets a sensitive path pattern: %s", [input.action_type, input.target])
}

approval_reasons contains reason if {
	input.action_type == "file_delete"
	input.environment == "prod"
	reason := "production file deletions require human approval"
}

require_approval := true if count(approval_reasons) > 0
