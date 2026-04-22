# M0 stub. Real implementation lands in M2 with the AWS provider.
# See docs/04-skills-system.md §2.1 for plan()/run() conventions.
def plan(ctx):  # noqa: ARG001 — signature stable for the real impl
    return {"effects": []}


def run(ctx):  # noqa: ARG001
    raise NotImplementedError("infra.aws.vm.list runs in M2")
