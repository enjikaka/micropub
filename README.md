# micropub

A micropub server for Lume blogs.

## Inner workings

## Create

Creating a post will render the output in the `h-${type}` folder as markdown files.

A typical h-entry will therefore end up in the `h-entry/` folder.

Images/photos in mulipart requests be sent to `/img`.

## Delete

Deleting a post will edit the markdown metadata to `draft: true`

## Undelete

Undeleting a post will edit the markdown metadata to `draft: false`

## Todo

- Add static server to `public/` folder.
- Support query and updates in micropub api
- Run Lume generation on changes
