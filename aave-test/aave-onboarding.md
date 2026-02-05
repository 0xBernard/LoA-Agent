Aave forum post links and titles are in the database, review the schema.
You may add data to the agent context in the database or as text in a context.md

Aave links:
https://aave.com/docs (use the web crawler skill to parse and read)
Github Repo's
https://github.com/aave
https://github.com/aave/aave-v4
https://github.com/aave/aave-v4-sdk
https://github.com/aave/aave-sdk
https://github.com/aave/aave-v3-horizon
https://github.com/aave-dao/aave-v3-origin
https://github.com/aave-dao/aave-governance-v3
https://github.com/aave-dao/aave-permissions-book

Discourse API Calls:
Use the Discourse topic JSON endpoint. From a stored topic URL like
https://governance.aave.com/t/some-slug/21248, you can call:
Full topic (all posts + raw/cooked):
GET https://governance.aave.com/t/21248.json
or
GET https://governance.aave.com/t/some-slug/21248.json
The full text is in:
post_stream.posts[].raw (markdown)
post_stream.posts[].cooked (HTML)
If you only want one post:
GET https://governance.aave.com/t/21248/posts.json?post_ids[]=12345