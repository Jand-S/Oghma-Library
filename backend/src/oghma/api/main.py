from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .monitor import router as monitor_router
from .routes import router

app = FastAPI(title="Oghma Library API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
app.include_router(monitor_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
