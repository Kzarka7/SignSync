from fastapi import WebSocket


class ConnectionManager:
    """Tracks active WebSocket connections. A single-user capstone demo
    only ever has one, but this is where broadcasting to multiple
    observers (e.g. a second screen showing the same conversation) would
    plug in later."""

    def __init__(self) -> None:
        self.active: list[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active.append(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self.active:
            self.active.remove(websocket)


manager = ConnectionManager()
