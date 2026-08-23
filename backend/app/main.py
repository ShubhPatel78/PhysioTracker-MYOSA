import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import engine, Base
from app.routers import auth, patients, thresholds, exercise, sessions

# Create DB tables
@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="PhysioPulse Backend API – Patient history, exercise metrics, doctor prescriptions and sensor sessions",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routers
app.include_router(auth.router)
app.include_router(patients.router)
app.include_router(thresholds.router)
app.include_router(exercise.router)
app.include_router(sessions.router)

@app.get("/api/health")
def health_check():
    return {"status": "ok", "app": settings.PROJECT_NAME, "version": "1.0.0"}

# Mount WebApp static frontend if available
if settings.WEBAPP_DIR.exists() and (settings.WEBAPP_DIR / "index.html").exists():
    app.mount("/", StaticFiles(directory=str(settings.WEBAPP_DIR), html=True), name="webapp")
