"""The AgriTwin MCP server: the single processing layer and data gateway.

`tools.py` holds the tool implementations as plain, audit-logged Python functions.
`server.py` exposes them over MCP (stdio or streamable HTTP) with resources and prompts.
The REST bridge in `agritwin.api` calls the same functions, so there is one code path to the store."""
