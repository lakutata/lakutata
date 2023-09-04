## Description

The purpose of the HttpRequest class is to send HTTP requests from within a program to external sources. It supports
various HTTP methods such as GET, POST, PUT, DELETE, OPTIONS, etc. Using the HttpRequest class, you can easily initiate
HTTP requests and handle the response. This class utilizes Axios as the request handling library and provides additional
encapsulation on top of it.

## How to Use

    import {HttpRequest} from 'lakutata'

## Use Case

- Send a GET request and return JSON data:

```typescript
const url = "https://api.example.com/data";
const request = HttpRequest.get(url);

try {
    const data = await request.json();
    console.log(data);
} catch (error) {
    console.error(error);
}
```

- Send a POST request and return plain text data:

```typescript
const url = "https://api.example.com/submit";
const body = {name: "John Doe", age: 30};
const request = HttpRequest.post(url, {body});

try {
    const text = await request.text();
    console.log(text);
} catch (error) {
    console.error(error);
}
```

- Send a DELETE request:

```typescript
const url = 'https://api.example.com/delete/123'
const request = HttpRequest.delete(url)

try {
    await request.json()
    console.log('Delete request successful')
} catch (error) {
    console.error(error)
}
```

- Send a HEAD request and retrieve the response header information:

```typescript
const url = "https://api.example.com/info";
const request = HttpRequest.head(url);

try {
    await request.json();
    const headers = request.responseHeaders();
    console.log(headers);
} catch (error) {
    console.error(error);
}
```
