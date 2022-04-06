import { http, fs } from './deps.ts';

const envPort = Deno.env.get('PORT');
const port = envPort ? parseInt(envPort, 10) : 8080;

const textEncoder = new TextEncoder();

const mimeToExt: Record<string, string> = {
  'image/jpeg': 'jpg'
}

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string = '') {
    super();

    this.message = status + '';
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

  if (accessTokenFromBody && accessTokenFromHeader) {
    throw new HttpError(400);
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
    lines.push(`${key}: ${JSON.stringify(val)}`);
  }

  lines.push('---');

  return lines.join('\n');
}

async function micropubUndeletePost(request: Request): Promise<Response> {
  const formData = await request.formData();
  const url = formData.get('url');

  if (url) {
    const path = `./${url.toString()}.md`;

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

  if (url) {
    const path = `./${url.toString()}.md`;

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

async function uploadImage (image: File, postId: string) {
  const fileExtention = mimeToExt[image.type];

  if (fileExtention) {
    const fileSavePath = `/img/${postId}.${fileExtention}`;
    const arrBuff = await image.arrayBuffer();

    await fs.ensureDir(`./img`);
    await Deno.create(`./${fileSavePath}`);
    await Deno.writeFile(`.${fileSavePath}`, new Uint8Array(arrBuff));

    return fileSavePath;
  }
}

async function micropubCreatePost(request: Request): Promise<Response> {
  const formData = await request.formData();
  const postContentHash = await checksum(formData.get('content')?.toString() ?? '');
  const timeHash = await checksum(Date.now() + '');
  const postId = `${new Date().toISOString().split('T')[0]}-${postContentHash.substring(0, 3)}${timeHash.substring(0, 3)}`;
  const metadata: Record<string, any> = {};
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
      'Location': `/h-${type}/${postId}`
    })
  });
}

async function micropubHandler (request: Request): Promise<Response> {
  try {
    const accessToken = await findAccessToken(request.clone());

    const formData = await request.clone().formData();
    const action = formData.get('action');

    if (action === 'delete') {
      return micropubDeletePost(request.clone());
    } else if (action === 'undelete') {
      return micropubUndeletePost(request.clone());
    } else if (!action) {
      return micropubCreatePost(request.clone());
    }

    return new Response(accessToken, {
      status: 202,
      headers: {
        'Location': '/'
      }
    });
  } catch (e) {
    if (e instanceof HttpError) {
      return new Response(e.message, {
        status: e.status
      });
    } else {
      console.error(e);

      return new Response(null, {
        status: 500
      });
    }
  }
}

function handler (request: Request): Promise<Response> | Response  {
  const url = new URL(request.url);

  if (url.pathname === '/micropub') {
    return micropubHandler(request);
  }

  return new Response('', {
    status: 404
  });
}

console.log('Running on http://localhost:' + port);

http.serve(handler, { port });
