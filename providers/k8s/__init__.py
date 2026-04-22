# M0 stub. Real Kubernetes provider lands in M2.
NAME = "k8s"


def capabilities() -> set[tuple[str, str]]:
    return {
        ("pod", "list"),
        ("pod", "get"),
        ("pod", "logs"),
        ("deployment", "scale"),
    }
