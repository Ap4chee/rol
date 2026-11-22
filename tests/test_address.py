import asyncio

import httpx
import pytest

from app.sources import SourceError, address


def test_address_search_normalizes_input_and_projects_gugik_coordinates():
    def respond(request):
        assert request.url.params["address"] == "Marki, Andersa 1"
        return httpx.Response(200, json={"results": {"1": {
            "city": "Marki", "street": "Andersa", "number": "1", "x": "644234.29", "y": "499514.03",
            "jednostka": "{Polska,mazowieckie,wołomiński,Marki}",
        }}})

    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            [match] = await address.search(client, "Andersa 1, Marki")
        assert match.label == "Marki, Andersa 1" and match.precise
        assert match.point.lon == pytest.approx(21.118, abs=0.001)
        assert match.point.lat == pytest.approx(52.343, abs=0.001)

    asyncio.run(check())


def test_address_search_distinguishes_no_matches_from_provider_error():
    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(
            lambda request: httpx.Response(200, json={"results": None})
        )) as client:
            assert await address.search(client, "Brak wyników") == []
        async with httpx.AsyncClient(transport=httpx.MockTransport(
            lambda request: httpx.Response(502)
        )) as client:
            with pytest.raises(SourceError, match="chwilowo nie odpowiada"):
                await address.search(client, "Marki")

    asyncio.run(check())
