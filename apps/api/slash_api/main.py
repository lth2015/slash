from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from slash_api import __version__
from slash_api.routers import approvals, audit, context, execute, explain, health, help, parse, skills

app = FastAPI(
    title="Slash API",
    version=__version__,
    description="Backend for the Slash SRE cockpit. See docs/03-architecture.md.",
)

app.add_middleware(
    CORSMiddleware,
    # Loopback + RFC1918 private ranges (10/8, 172.16/12, 192.168/16) so
    # peers on the office LAN can hit this instance directly. Public
    # internet origins are still blocked. Audit records the OS user of
    # the API process as the actor — LAN trust is the security boundary.
    allow_origin_regex=(
        r"^https?://"
        r"(localhost|127\.0\.0\.1"
        r"|10(\.\d{1,3}){3}"
        r"|192\.168(\.\d{1,3}){2}"
        r"|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}"
        r")(:\d+)?$"
    ),
    allow_methods=["GET", "POST"],
    allow_headers=["*", "X-Slash-Actor"],
)

app.include_router(health.router)
app.include_router(parse.router)
app.include_router(skills.router)
app.include_router(context.router)
app.include_router(execute.router)
app.include_router(approvals.router)
app.include_router(explain.router)
app.include_router(help.router)
app.include_router(audit.router)


@app.get("/")
def root() -> dict:
    return {
        "name": "slash-api",
        "version": __version__,
        "docs": "/docs",
    }
