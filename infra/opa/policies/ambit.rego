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

require_approval := true if count(approval_reasons) > 0
