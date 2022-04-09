import { http, fs, streams, mime } from './deps.ts';
import { decodeMdMetadata, encodeMdMetadata } from "./frontmatter.ts";
import { formDataToJSON } from "./helpers.ts";

const envPort = Deno.env.get('PORT');
const port = envPort ? parseInt(envPort, 10) : 8080;

const textEncoder = new TextEncoder();

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string = '') {
    super();

    this.message = status + ': ' + message;
    this.status = status;
  }
}

async function findAccessToken (request: Request): Promise<string> {
  let accessTokenFromHeader;
  let accessTokenFromBody;

  const authorizationHeader = request.headers.get('Authorization');

  if (authorizationHeader) {
    accessTokenFromHeader = authorizationHeader.split(' ')[1];
  }

  const contentType = request.headers.get('Content-Type');

  if (
    (contentType?.includes('application/x-www-form-urlencoded') || contentType?.includes('multipart/form-data')) && request.body !== null
  ) {
    const formData = await request.formData();
    const accessToken = formData.get('access_token');

    if (accessToken) {
      accessTokenFromBody = accessToken.toString();
    }
  }

  if (accessTokenFromBody && accessTokenFromHeader) {
    throw new HttpError(400, 'Access token not allowed in both header and body at the same time');
  }

  if (accessTokenFromBody && !accessTokenFromHeader) {
    return accessTokenFromBody;
  } else if (accessTokenFromHeader && !accessTokenFromBody) {
    return accessTokenFromHeader;
  } else {
    throw new HttpError(401);
  }
}

async function checksum (data: string) {
  const encodedData = textEncoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-1', encodedData.buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  return hashHex;
}

async function setDraft (url: string, draft: boolean) {
  const { pathname } = new URL(url);
  const path = `.${pathname}.md`;

  const text = await Deno.readTextFile(path);
  const metaData = decodeMdMetadata(text);

  console.log(metaData);

  metaData.draft = draft;

  const newMetaData = encodeMdMetadata(metaData);

  const newText = newMetaData + text.split('---')[2];

  await Deno.writeTextFile(path, newText);

  return new Response(null, {
    status: 204
  });
}

async function micropubUndeletePost(request: Request): Promise<Response> {
  const url = await getValueFromBody('url', request);

  if (url) {
    return setDraft(url, false);
  }

  throw new HttpError(400, 'No URL entry');
}

async function micropubDeletePost(request: Request): Promise<Response> {
  const url = await getValueFromBody('url', request);

  if (url) {
    return setDraft(url, true);
  }

  throw new HttpError(400, 'No URL entry');
}

async function uploadImage (image: mime.FormFile, prefix?: string) {
  console.log('uploadImage', image);

  if (!image.content) return;

  const fileSavePath = `/img/${prefix ? `${prefix}-` : ''}${image.filename}`;

  await fs.ensureDir(`./img`);
  const file = await Deno.open(`./${fileSavePath}`, { write: true, create: true });
  await streams.writeAll(file, image.content);

  return fileSavePath;
}

export interface JSONCreateRequest {
  type: string,
  properties: {
    content: string[],
    photo?: Array<{ value: string, alt: string }>,
  } & Record<string, string[]>
};

/**
 * Adds date and postId to properties
 */
async function addCustomProperties (cr: JSONCreateRequest): Promise<JSONCreateRequest> {
  const dateString = new Date().toISOString().split('T')[0];
  const timeHash = await checksum(Date.now() + '');
  const postContentHash = await checksum(cr.properties.content[0]);
  const postId = `${dateString}-${postContentHash.substring(0, 3)}${timeHash.substring(0, 3)}`;

  cr.properties.date = [dateString];
  cr.properties.postId = [postId];
  cr.properties.h = [cr.type[0].split('h-')[1]];

  return cr;
}

function parseContent(contentArray: Array<string | { html: string }>) {
  return contentArray.map(x => typeof x === 'string' ? x : x.html).join('<br>');
}

async function micropubCreatePost(request: Request): Promise<Response> {
  let createRequest: JSONCreateRequest | undefined;

  if (
    request.headers.get('content-type')?.includes('application/x-www-form-urlencoded') ||
    request.headers.get('content-type')?.includes('multipart/form-data')
  ) {
    const formData = await request.clone().formData();
    let _createRequest = await formDataToJSON(formData);

    _createRequest = await addCustomProperties(_createRequest);

    let photos: Array<mime.FormFile> | undefined;

    if ((formData.has('photo') || formData.has('photo[]')) && request.headers.get('content-type')?.includes('multipart/form-data')) {
      photos = [];

      if (request.body) {
        const r = streams.readerFromStreamReader(request.body.getReader());
        const mr = new mime.MultipartReader(r, request.headers.get('content-type')?.split('boundary=')[1] ?? '');

        const mpFormData = await mr.readForm();

        for (const [key, val] of mpFormData.entries()) {
          if (val) {
            for (const v of val) {
              if ((key === 'photo' || key === 'photo[]') && mime.isFormFile(v)) {
                photos.push(v);
              }
            }
          }
        }
      }
    }

    if (photos && _createRequest) {
      const uploadedPhotos = await Promise.all(
        photos.map(async p => {
          const value = await uploadImage(p, _createRequest.properties.postId[0]);

          return value ? { value, alt: '' } : undefined;
        })
      );

      _createRequest.properties.photo = uploadedPhotos.filter(Boolean) as Array<{
        value: string;
        alt: string;
      }>;
    }

    createRequest = _createRequest;
  }

  if (request.headers.get('content-type')?.includes('application/json')) {
    const _createRequest = await request.json();

    createRequest = await addCustomProperties(_createRequest);
  }

  if (createRequest) {
    const { type, properties } = createRequest;
    const fileContents = [encodeMdMetadata(createRequest.properties), parseContent(createRequest.properties.content)].join('\n\n');

    await fs.ensureDir(`./${type}`);
    await Deno.create(`./${type}/${properties.postId[0]}.md`);
    await Deno.writeTextFile(`./${type}/${properties.postId[0]}.md`, fileContents);

    return new Response(null, {
      status: 201,
      headers: new Headers({
        'Location': `${new URL(request.url).origin}/${type}/${properties.postId[0]}`
      })
    });
  }

  return new Response(null, { status: 500 });
}

async function micropubQuery(request: Request): Promise<Response> {
  const requestURL = new URL(request.url);
  const q = requestURL.searchParams.get('q');

  if (q) {
    if (q === 'config') {
      return new Response(JSON.stringify({ 'media-endpoint': requestURL.origin + '/micropub/upload-media' }), {
        status: 200,
        headers: new Headers({
          'Content-Type': 'application/json'
        })
      });
    }

    if (q === 'syndicate-to') {
      return new Response(JSON.stringify({ 'syndicate-to': [] }), {
        status: 200,
        headers: new Headers({
          'Content-Type': 'application/json'
        })
      });
    }

    if (q === 'source') {
      const url = requestURL.searchParams.get('url');
      const requestedProps = requestURL.searchParams.getAll('properties[]');

      if (url) {
        const { pathname } = new URL(url);
        const path = `.${pathname}.md`;

        const text = await Deno.readTextFile(path);
        const metaData = decodeMdMetadata(text);
        const [,, content] = text.split('---');

        const properties: Record<string, string[]> = {
          ...metaData,
          content: [content.trim()]
        };

        return new Response(JSON.stringify({
          type: 'h-' + metaData.h,
          properties: requestedProps ? requestedProps.reduce((acc, curr) => ({
            ...acc,
            [curr]: properties[curr],
          }), {}) : properties
        }), {
          status: 200,
          headers: new Headers({
            'Content-Type': 'application/json'
          })
        });
      }
    }
  }

  throw new HttpError(404);
}

async function micropubMediaEndpoint (request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (request.headers.get('content-type')?.includes('multipart/form-data')) {
    if (request.body) {
      let path;
      const r = streams.readerFromStreamReader(request.body.getReader());
      const mr = new mime.MultipartReader(r, request.headers.get('content-type')?.split('boundary=')[1] ?? '');

      const mpFormData = await mr.readForm();

      for (const [key, val] of mpFormData.entries()) {
        console.log([key, val]);
        if (val) {
          for (const v of val) {
            if (key === 'file' && mime.isFormFile(v)) {
              path = await uploadImage(v);
            }
          }
        }
      }

      if (path) {
        return new Response(null, {
          status: 201,
          headers: new Headers({
            'Location': url.origin + path
          })
        });
      }
    }
  }

  throw new HttpError(400, 'Bad Request');
}

async function getValueFromBody (key: string, request: Request): Promise<string | undefined> {
  let value;

  if (request.headers.get('content-type')?.includes('application/x-www-form-urlencoded') || request.headers.get('content-type')?.includes('multipart/form-data')) {
    console.log('reading form data...');
    const formData = await request.clone().formData();
    console.log('reading form data... done.', formData);

    value = formData.get(key)?.toString();
  }

  if (request.headers.get('content-type')?.includes('application/json')) {
    const json = await request.clone().json();

    value = json[key];
  }

  return value;
}

async function getAction (request: Request): Promise<'delete' | 'undelete' | 'create'> {
  const action = await getValueFromBody('action', request);

  switch (action) {
    case 'delete':
      return 'delete';
    case 'undelete':
        return 'undelete';
    default:
      return 'create';
  }
}

async function micropubHandler (request: Request): Promise<Response> {
  try {
    const accessToken = await findAccessToken(request.clone());

    if (request.method === 'GET' && new URL(request.url).searchParams.has('q')) {
      return micropubQuery(request);
    }

    if (request.method === 'POST') {
      const pathname = new URL(request.url).pathname;

      if (pathname === '/micropub/upload-media') {
        return micropubMediaEndpoint(request);
      }

      console.log(request);

      const action = await getAction(request);

      console.log(action);

      if (action === 'delete') {
        return micropubDeletePost(request.clone());
      } else if (action === 'undelete') {
        return micropubUndeletePost(request.clone());
      } else if (action === 'create') {
        return micropubCreatePost(request.clone());
      }
    }


    return new Response(accessToken, {
      status: 202,
      headers: {
        'Location': '/'
      }
    });
  } catch (e) {
    console.log(e);

    if (e instanceof HttpError) {
      return new Response(e.message, {
        status: e.status,
        statusText: e.message
      });
    } else {
      return new Response(null, {
        status: 500
      });
    }
  }
}

Deno.run({
  cmd: [
    "deno",
    "run",
    "--allow-read",
    "--allow-net",
    "https://deno.land/std@0.133.0/http/file_server.ts",
    "_site",
  ]
});

function runLume () {
  Deno.run({
    cmd: [
      "deno",
      "run",
      "--allow-run",
      "--allow-read",
      "--allow-write",
      "--allow-net",
      "https://deno.land/x/lume@v1.7.2/ci.ts"
    ]
  });
}

runLume();

async function handler (request: Request): Promise<Response>  {
  const url = new URL(request.url);

  if (
    url.pathname === '/micropub' ||
    url.pathname === '/micropub/upload-media'
  ) {
    const response = await micropubHandler(request);

    runLume();

    return response;
  }

  return fetch('http://localhost:4507' + url.pathname);
}

console.log('Running on http://localhost:' + port);

http.serve(handler, { port });
