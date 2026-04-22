from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from slash_api import __version__
from slash_api.routers import approvals, audit, context, execute, explain, health, parse, skills

app = FastAPI(
    title="Slash API",
    version=__version__,
    description="Backend for the Slash SRE cockpit. See docs/03-architecture.md.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4455", "http://127.0.0.1:4455"],
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
app.include_router(audit.router)


@app.get("/")
def root() -> dict:
    return {
        "name": "slash-api",
        "version": __version__,
        "docs": "/docs",
    }
