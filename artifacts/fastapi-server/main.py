from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import races, entries, passing_orders, batch_jobs, analysis

app = FastAPI(title="Horse Racing Data Correction API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(races.router)
app.include_router(entries.router)
app.include_router(passing_orders.router)
app.include_router(batch_jobs.router)
app.include_router(analysis.router)


@app.get("/fastapi/healthz")
def health_check():
    return {"status": "ok"}
