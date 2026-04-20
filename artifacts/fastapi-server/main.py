from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from routers import races, corrections, analysis, masters, jobs
from routers import analysis_results, batch_jobs, bbox, audit  # stubs

app = FastAPI(title="Furlong CUBE - Horse Racing Data Correction API v2")


@app.get("/")
def root():
    return RedirectResponse(url="/docs")


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Active routers
app.include_router(races.router)
app.include_router(corrections.router)
app.include_router(analysis.router)
app.include_router(masters.router)
app.include_router(jobs.router)

# Stub routers (kept for import compatibility, no active routes)
app.include_router(analysis_results.router)
app.include_router(batch_jobs.router)
app.include_router(bbox.router)
app.include_router(audit.router)


@app.get("/fastapi/healthz")
def health_check():
    return {"status": "ok", "version": "v2"}
