import logging
from typing import List
from fastapi import WebSocket

logger = logging.getLogger(__name__)
active_connections: List[WebSocket] = []

async def connect(websocket: WebSocket):
    await websocket.accept()
    active_connections.append(websocket)

async def disconnect(websocket: WebSocket):
    if websocket in active_connections:
        active_connections.remove(websocket)

async def send_to_all(data: dict):
    failed = []
    for connection in active_connections:
        try:
            await connection.send_json(data)
        except Exception as e:
            logger.warning(f"WebSocket send failed: {e}")
            failed.append(connection)
    for conn in failed:
        if conn in active_connections:
            active_connections.remove(conn)