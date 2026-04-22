# M0 stub. Real GCP provider lands in M2.
NAME = "gcp"


def capabilities() -> set[tuple[str, str]]:
    return {("vm", "list"), ("vm", "get")}
