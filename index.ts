import { http, fs } from './deps.ts';

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
    (contentType === 'application/x-www-form-urlencoded' ||
    contentType === 'multipart/form-data') && request.body !== null
  ) {
    const formData = await request.formData();
    const accessToken = formData.get('access_token');

    if (accessToken) {
      accessTokenFromBody = accessToken.toString();
    }
  }

  console.log({ accessTokenFromBody, accessTokenFromHeader });

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

function decodeMdMetadata (text: string): Record<string, any> {
  const metaDataBlock = text.split('---')[1].split('---')[0];
  const nonEmptyLines = metaDataBlock.split('\n').filter(Boolean);
  const metaData = nonEmptyLines.reduce((acc, curr) => {
    const [key, val] = curr.split(': ');

    acc[key] = val;

    return acc;
  }, {} as Record<string, any>);

  console.log(metaData);

  return metaData;
}

function encodeMdMetadata (metadata: Record<string, any>): string {
  const lines = ['---'];

  for (const [key, val] of Object.entries(metadata)) {
    lines.push(`${key}: ${Array.isArray(val) ? JSON.stringify(val) : val}`);
  }

  lines.push('---');

  return lines.join('\n');
}

async function micropubUndeletePost(request: Request): Promise<Response> {
  const formData = await request.formData();
  const url = formData.get('url');

  if (url && typeof url === 'string') {
    const { pathname } = new URL(url);
    const path = `.${pathname}.md`;

    const text = await Deno.readTextFile(path);
    const metaData = decodeMdMetadata(text);

    metaData.draft = false;

    const newMetaData = encodeMdMetadata(metaData);

    const newText = newMetaData + text.split('---')[2];

    await Deno.writeTextFile(path, newText);

    return new Response(null, {
      status: 204
    });
  }

  throw new HttpError(400, 'No URL entry');
}

async function micropubDeletePost(request: Request): Promise<Response> {
  const formData = await request.formData();
  const url = formData.get('url');

  if (url && typeof url === 'string') {
    const { pathname } = new URL(url);
    const path = `.${pathname}.md`;

    const text = await Deno.readTextFile(path);
    const metaData = decodeMdMetadata(text);

    metaData.draft = true;

    const newMetaData = encodeMdMetadata(metaData);

    const newText = newMetaData + text.split('---')[2];

    await Deno.writeTextFile(path, newText);

    return new Response(null, {
      status: 204
    });
  }

  throw new HttpError(400, 'No URL entry');
}

async function uploadImage (image: File, prefix?: string) {
  const fileSavePath = `/img/${prefix ? `${prefix}-` : ''}${image.name}`;
  const arrBuff = await image.arrayBuffer();

  await fs.ensureDir(`./img`);
  await Deno.create(`./${fileSavePath}`);
  await Deno.writeFile(`.${fileSavePath}`, new Uint8Array(arrBuff));

  return fileSavePath;
}

async function micropubCreatePost(request: Request): Promise<Response> {
  const formData = await request.formData();
  const postContentHash = await checksum(formData.get('content')?.toString() ?? '');
  const timeHash = await checksum(Date.now() + '');
  const dateString = new Date().toISOString().split('T')[0];
  const postId = `${dateString}-${postContentHash.substring(0, 3)}${timeHash.substring(0, 3)}`;
  const metadata: Record<string, any> = {
    date: dateString
  };
  const type = formData.get('h')?.toString() || 'entry';

  for (const [key, val] of formData.entries()) {
    const disallowedKeys = ['content'];

    if (!disallowedKeys.includes(key)) {
      if (key.includes('[')) {
        const cleanKey = key.split('[')[0];

        if (Array.isArray(metadata[cleanKey])) {
          metadata[cleanKey].push(val);
        } else {
          metadata[cleanKey] = [val];
        }
      } else {
        metadata[key] = val;
      }
    }
  }

  if (metadata.photo) {
    let newValue;

    if (Array.isArray(metadata.photo)) {
      newValue = await Promise.all(metadata.photo.map((photo, i) => uploadImage(photo, `${postId}-${i+1}`)))
    } else {
      newValue = await uploadImage(metadata.photo, postId + '-1');
    }

    metadata.photo = newValue;
  }

  const fileContents = [encodeMdMetadata(metadata), formData.get('content')].join('\n\n');

  await fs.ensureDir(`./h-${type}`);
  await Deno.create(`./h-${type}/${postId}.md`);
  await Deno.writeTextFile(`./h-${type}/${postId}.md`, fileContents);

  return new Response(null, {
    status: 201,
    headers: new Headers({
      'Location': `${new URL(request.url).origin}/h-${type}/${postId}`
    })
  });
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
  }

  throw new HttpError(404);
}

async function micropubMediaEndpoint (request: Request): Promise<Response> {
  const url = new URL(request.url);
  const formData = await request.formData();
  const file = formData.get('file');

  if (file && file instanceof File) {
    const path = await uploadImage(file);

    return new Response(null, {
      status: 201,
      headers: new Headers({
        'Location': url.origin + path
      })
    });
  }

  throw new HttpError(400, 'Bad Request');
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

      const formData = await request.clone().formData();
      const action = formData.get('action');

      if (action === 'delete') {
        return micropubDeletePost(request.clone());
      } else if (action === 'undelete') {
        return micropubUndeletePost(request.clone());
      } else if (!action) {
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
    console.error(e);

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

  if (url.pathname.includes('/micropub')) {
    const response = await micropubHandler(request);

    runLume();

    return response;
  }

  return fetch('http://localhost:4507' + url.pathname);
}

console.log('Running on http://localhost:' + port);

http.serve(handler, { port });
