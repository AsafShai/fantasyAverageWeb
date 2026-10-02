#!/usr/bin/env bash
input=$(cat)
cmd=$(echo "$input" | python -c "import json,sys; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('command',''))" 2>/dev/null)

if echo "$cmd" | grep -qE '^\s*git\s+push'; then
  if echo "$cmd" | grep -qE '(origin|upstream)\s+(master|main)\b'; then
    echo '{"decision":"block","reason":"Pushing to master/main is blocked. Push to dev or a feature branch. If you really need to push to master, run the git command manually in a terminal."}'
    exit 0
  fi
fi
exit 0
