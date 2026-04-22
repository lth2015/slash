from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from slash_api import __version__
from slash_api.routers import health, parse, skills

app = FastAPI(
    title="Slash API",
    version=__version__,
    description="Backend for the Slash SRE command palette. See docs/03-architecture.md.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4455", "http://127.0.0.1:4455"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(parse.router)
app.include_router(skills.router)


@app.get("/")
def root() -> dict:
    return {
        "name": "slash-api",
        "version": __version__,
        "docs": "/docs",
        "milestone": "M0 · Foundation",
    }
