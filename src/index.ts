
/**
 * Hooks are essentially a middleware, with only differences is that a hook
 * can't stop request flow and is not required to return anything
 */
type Hooks = {
    /**
     * Runs before request is fetched
     *
     * @param request - `Request` instance passed to `send` method
     * @returns `Request` - will be passed to next hook in sequence
     * @returns `void` - same as returning `request` parameter unaffected
     */
    onCreated: (request: Request) => Request | void;

    /**
     *  Runs after request, if it was successful
     *
     * @param response - has no access to body to prevent consuming it early
     * @returns nothing to leave response untouched or new Response instance to substitute request result
     */
    onSuccess: (response: Omit<Response, keyof Body>) => Response | void;

    /**
     * Runs after request, if error was thrown
     *
     * @param failure anything that was thrown in previous hooks, during fetch or while consuming body
     * @returns any other error you deem to fit, **avoid throwing inside this hook**
     */
    onFailure: (failure: unknown) => unknown | void;
    /**
     * Runs unconditionally after request
     *
     * @returns nothing
     */
    onSettled: () => void;
};

type HookSequences = {
    [Key in keyof Hooks]: Array<Hooks[Key]>;
};

export default class HttpClient {
    private constructor(private readonly hooks: HookSequences) { }

    static create(hooks: Partial<Hooks> = {}) {
        return new HttpClient(HookSequences.from(hooks));
    }

    static extend(client: HttpClient, hooks: Partial<Hooks> = {}) {
        return new HttpClient(
            HookSequences.concat(client.hooks, HookSequences.from(hooks))
        );
    }

    public async call<E extends HttpEndpoint<any, any, any, any>>(
        endpoint: E,
        params: HttpEndpoint.ParamsFor<E>,
        body: HttpEndpoint.BodyFor<E>
    ) {
        const request = endpoint.toRequest(params, body)
        const response = await this.send(request)

    }

    public async send(request: Request,): Promise<Response> {
        const { onCreated, onSuccess, onFailure, onSettled } = this.hooks;
        try {
            for (const hook of onCreated) {
                request = hook(request) ?? request;
            }
            let response = await fetch(request);
            for (const hook of onSuccess) {
                response = hook(response) ?? response;
            }
            return response;
        } catch (failure) {
            for (const hook of onFailure) {
                failure = hook(failure) ?? failure;
            }
            throw failure;
        } finally {
            for (const hook of onSettled) {
                hook();
            }
        }
    }
}

namespace HookSequences {
    export function from(hooks: Partial<Hooks>): HookSequences {
        return {
            onCreated: hooks.onCreated ? [hooks.onCreated] : [],
            onSuccess: hooks.onSuccess ? [hooks.onSuccess] : [],
            onFailure: hooks.onFailure ? [hooks.onFailure] : [],
            onSettled: hooks.onSettled ? [hooks.onSettled] : [],
        };
    }

    export function concat(target: HookSequences, source: HookSequences) {
        return {
            onCreated: target.onCreated.concat(source.onCreated),
            onSuccess: target.onSuccess.concat(source.onSuccess),
            onFailure: target.onFailure.concat(source.onFailure),
            onSettled: target.onSettled.concat(source.onSettled),
        };
    }
}

type HttpRestQueryMethod = typeof HttpRestQueryMethod[keyof typeof HttpRestQueryMethod];
const HttpRestQueryMethod = <const>{
    Get: "GET",
    Head: "HEAD",
    Options: "OPTIONS",
}

type HttpRestMutationMethod = typeof HttpRestMutationMethod[keyof typeof HttpRestMutationMethod];
const HttpRestMutationMethod = <const>{
    Post: "POST",
    Put: "PUT",
    Patch: "PATCH",
    Delete: 'DELETE',
}


type HttpRestMethod = typeof HttpRestMethod[keyof typeof HttpRestMethod];
const HttpRestMethod = <const>{
    ...HttpRestQueryMethod,
    ...HttpRestMutationMethod,
}

// TODO: thing who to conveniently reuse headers
class HttpEndpoint<Url extends string, Method extends HttpRestMethod, Input, Output> {
    static readonly defaults = <const>{
        method: "GET",
        headers: () => ({}),
        inputKey: <InferenceKey<any>>Symbol(),
        isOutput: <Predicate<any>>((d): d is any => true),
    };

    private constructor(
        private readonly config: Readonly<{
            url: Url;
            method: Method;
            headers: Lazy<HeadersInit>;
            inputKey: InferenceKey<Input>;
            isOutput: Predicate<Output>;
        }>
    ) { }

    static url<Url extends string>(url: Url) {
        return new HttpEndpoint({
            ...this.defaults,
            url
        });
    }

    method<Method extends HttpRestMethod>(method: Method) {
        return new HttpEndpoint({
            ...this.config,
            method
        });
    }

    headers(headers: HeadersInit | { new(): Headers }) {
        return new HttpEndpoint({
            ...this.config,
            headers: typeof headers !== "function" ? () => headers : () => new headers(),
        });
    }

    expects<Input>(): HttpEndpoint<Url, Method, Input, Output> {
        return new HttpEndpoint({
            ...this.config,
            inputKey: Symbol() as InferenceKey<Input>,
        });
    }

    returns<Output>(guard: Confirmable<Output> | Predicate<Output>) {
        return new HttpEndpoint({
            ...this.config,
            isOutput: "is" in guard ? guard.is : guard,
        });
    }

    toRequest(params: HttpEndpoint.UrlParams<Url>, data: Input) {
        const url = this.toUrl(params)
        const method = this.config.method
        const headers = this.config.headers()
        const body = JSON.stringify(data)

        return new Request(url, { body, headers, method })
    }

    toUrl(params: HttpEndpoint.UrlParams<Url>) {
        let url: string = this.config.url
        Object.keys(params).forEach(key => {
            url = url.replace(`{${key}}`, Reflect.get(params, key))
        })
        return url
    }
}

namespace HttpEndpoint {
    type UrlArgKeys<Url extends string> =
        Url extends `${string}/{${infer Arg}}${infer RestOfUrl}`
        ? HasArgs<RestOfUrl> extends true
        ? Arg | UrlArgKeys<RestOfUrl>
        : Arg
        : never;

    type HasArgs<Url extends string> =
        Url extends `${string}/{${string}}${string}` ? true : false;

    export type UrlParams<Url extends string> = Record<UrlArgKeys<Url>, string>;

    export type BodyFor<E> = E extends HttpEndpoint<any, any, infer I, any>
        ? I
        : never;

    export type ParamsFor<E> = E extends HttpEndpoint<infer U, any, any, any>
        ? UrlParams<U>
        : never;
}


interface InferenceKey<T> extends Symbol { }

interface Confirmable<Output> {
    is: (data: any) => data is Output;
};

type Lazy<T> = () => T;

type Predicate<T> = (data: any) => data is T;


// ==== ==== ==== Tests ==== ==== ====
// prettier-ignore
let y = HttpEndpoint.url("api/{v1}").expects<{ qwe: 123 }>().returns({ is: (d): d is "sting" => d === "string" });
//  ^?
// function idk<E extends HttpEndpoint<any, any, any, any>>(end: E, thing: InputOf<E>) { }

// type InputOf<E> = E extends HttpEndpoint<any, any, infer I, any> ? I : never

HttpClient.create().call(y, { v1: 'qwe' }, { qwe: 123 });
