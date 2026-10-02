# Rover history controls

Add individual remove buttons to finished recent evaluations, scoped to the visible provider. Dismissal only hides Rover history; assignment outcomes, active jobs, and MCPLab artifacts remain intact. Mark current completed items as hidden so later archiving cannot restore them. Preserve backward compatibility with existing stored queues and clear the marker on explicit reruns.

Render passed evaluations as a green ✓ with an accessible Passed label. Keep other outcome labels.

Serialize dismissal through existing queue operations and persist in existing session storage. Show storage failures and allow retry. Verify domain invariants, message persistence, actual popup rendering and clicks, then run the full tests, typecheck, build, and diff check.
