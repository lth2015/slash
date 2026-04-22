# M0 stub. Real AWS provider lands in M2; see docs/03-architecture.md §4.
NAME = "aws"


def capabilities() -> set[tuple[str, str]]:
    return {("vm", "list"), ("vm", "get")}
