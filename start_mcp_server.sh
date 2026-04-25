#!/bin/bash
echo "Starting Super Productivity MCP Server..."
cd "$MCP_DIR"
python3 mcp_server.py
read -p "Press Enter to exit..."
