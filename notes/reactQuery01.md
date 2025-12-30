# 前端异步状态交互为什么需要 TanStack Query?

在现代前端开发中，异步状态管理是构建响应式应用的核心环节。`TanStack Query`（曾用名 `React Query`）通过强大的缓存、并发控制和错误处理机制，显著简化了异步状态的管理。

但有人可能会问：既然可以直接在 `useEffect` 中使用 `fetch` 发起请求，为什么还需要 `TanStack Query` 呢？

让我们先看看 Twitter 上一个典型的 `fetch-in-useEffect` 示例，并探讨为什么在这些场景下使用 `TanStack Query` 是明智的选择：

```tsx
const endpoint = 'https://api.example.com/bookmarks'

function Bookmarks({ category }) {
  const [data, setData] = useState([])
  const [error, setError] = useState()

  useEffect(() => {
    fetch(`${endpoint}/${category}`)
      .then(res => res.json())
      .then(d => setData(d))
      .catch(e => setError(e))
  }, [category])

  // 根据 data 和 error 返回 JSX
}
```

你可能会觉得这段代码对于简单的需求已经够用了。但我要告诉你，仅仅这 10 行代码里，我就立刻发现了 5 个隐藏的 Bug 🐛。

![](https://neptune-ipc.oss-cn-shenzhen.aliyuncs.com/img/20251226171439001.png)


不妨花一两分钟，看看你能找出几个？


## 1. 竞态条件 🏎️

上面的代码会在 `category` 变化时重新获取数据，这本身没错。但网络响应的到达顺序可能与请求的发送顺序不一致。比如，当你将 `category` 从 `books` 切换到 `movies` 时，`movies` 的响应可能比 `books` 的响应更早返回，最终导致组件中显示的数据是错误的。

![](https://neptune-ipc.oss-cn-shenzhen.aliyuncs.com/img/20251226160842558.png)

最终，你会陷入不一致的状态：你的本地状态显示你选中了 `movies`，但实际渲染的却是 `books` 的数据。

React 文档提到可以通过清理函数和一个 `ignore` 布尔标记来解决这个问题，让我们来实现一下：

```tsx
const endpoint = 'https://api.example.com/bookmarks'

function Bookmarks({ category }) {
  const [data, setData] = useState([])
  const [error, setError] = useState()

  useEffect(() => {
    let ignore = false
    fetch(`${endpoint}/${category}`)
      .then(res => res.json())
      .then(d => {
        if (!ignore) {
          setData(d)
        }
      })
      .catch(e => {
        if (!ignore) {
          setError(e)
        }
      })
    return () => {
      ignore = true
    }
  }, [category])

  // 根据 data 和 error 返回 JSX
}
```

现在，当 `category` 变化时，清理函数会执行，将本地的 `ignore` 标记设为 `true`。如果之后收到旧的 `fetch` 响应，它将不会再调用 `setState`。问题解决。

## 2. 加载状态 🕐

在请求进行时，我们没有任何方式展示加载状态的 UI——无论是首次请求还是后续请求。所以，我们添加一个加载状态如何？

```tsx
const endpoint = 'https://api.example.com/bookmarks'

function Bookmarks({ category }) {
  const [isLoading, setIsLoading] = useState(true)
  const [data, setData] = useState([])
  const [error, setError] = useState()

  useEffect(() => {
    let ignore = false
    setIsLoading(true)
    fetch(`${endpoint}/${category}`)
      .then(res => res.json())
      .then(d => {
        if (!ignore) {
          setData(d)
        }
      })
      .catch(e => {
        if (!ignore) {
          setError(e)
        }
      })
      .finally(() => {
        if (!ignore) {
          setIsLoading(false)
        }
      })
    return () => {
      ignore = true
    }
  }, [category])

  // 根据 data 和 error 返回 JSX
}
```

## 3. 空状态处理 🗑️

用空数组初始化 `data` 看似不错，可以避免频繁检查 `undefined`——但如果获取的某个 `category` 确实没有数据，返回的就是空数组，我们该如何区分“数据尚未加载”和“确实没有数据”呢？虽然我们刚添加的加载状态有所帮助，但更合理的做法是用 `undefined` 来初始化 `data`：

```tsx
const endpoint = 'https://api.example.com/bookmarks'

function Bookmarks({ category }) {
  const [isLoading, setIsLoading] = useState(true)
  const [data, setData] = useState()
  const [error, setError] = useState()

  useEffect(() => {
    let ignore = false
    setIsLoading(true)
    fetch(`${endpoint}/${category}`)
      .then(res => res.json())
      .then(d => {
        if (!ignore) {
          setData(d)
        }
      })
      .catch(e => {
        if (!ignore) {
          setError(e)
        }
      })
      .finally(() => {
        if (!ignore) {
          setIsLoading(false)
        }
      })
    return () => {
      ignore = true
    }
  }, [category])

  // 根据 data 和 error 返回 JSX
}
```

## 4. 切换分类时，数据和错误状态不会重置 🔄

`data` 和 `error` 是独立的状态变量，当 `category` 变化时并不会自动重置。这意味着，如果某个 `category` 的请求失败了，而我们切换到另一个成功获取的 `category` ，状态会变成：

```md
data: 当前 `category` 的数据
error: 之前 `category` 的错误
```

具体的 UI 表现取决于我们如何根据这个状态来渲染 JSX。如果我们优先检查 `error`，那么即使当前有有效数据，我们也会渲染出带有旧错误信息的错误界面：

```tsx
return (
  <div>
    {error ? (
      <div>Error: {error.message}</div> // 渲染旧的错误信息
    ) : ( // 新的数据无法渲染
      <ul>
        {data.map(item => (
          <li key={item.id}>{item.name}</li>
        ))}
      </ul>
    )}
  </div>
)
```

如果我们先检查数据，当第二个请求失败时，同样的问题也会发生。如果我们同时渲染错误和数据，我们又可能展示过时的信息。😔

要修复这个问题，我们需要在 `category` 变化时重置本地状态：

```tsx
const endpoint = 'https://api.example.com/bookmarks'

function Bookmarks({ category }) {
  const [isLoading, setIsLoading] = useState(true)
  const [data, setData] = useState()
  const [error, setError] = useState()

  useEffect(() => {
    let ignore = false
    setIsLoading(true)
    fetch(`${endpoint}/${category}`)
      .then(res => res.json())
      .then(d => {
        if (!ignore) {
          setData(d)
          setError(undefined) // 重置错误
        }
      })
      .catch(e => {
        if (!ignore) {
          setError(e)
          setData(undefined) // 重置数据
        }
      })
      .finally(() => {
        if (!ignore) {
          setIsLoading(false)
        }
      })
    return () => {
      ignore = true
    }
  }, [category])

  // 根据 data 和 error 返回 JSX
}
```

## 5. 在 StrictMode 下 Effect 会执行两次 🔥🔥

这与其说是 Bug，不如说是一个常见的“陷阱”，但它常常让 React 新手感到困惑。如果你的应用包裹在 `<React.StrictMode>` 中，React 在开发模式下会故意执行两次 Effect，以帮助你发现缺少清理函数等问题。

## 6. 额外Bug：错误处理 🚨

`fetch` 在收到 HTTP 错误响应时不会进入 `reject` 状态，因此需要检查 `res.ok` 并手动抛出错误。这一点在使用 `TanStack Query` 时同样需要注意。

```tsx
const endpoint = 'https://api.example.com/bookmarks'

function Bookmarks({ category }) {
  const [isLoading, setIsLoading] = useState(true)
  const [data, setData] = useState()
  const [error, setError] = useState()

  useEffect(() => {
    let ignore = false
    setIsLoading(true)
    fetch(`${endpoint}/${category}`)
      .then(res => {
        if (!res.ok) {
          throw new Error('Failed to fetch')
        }
        return res.json()
      })
      .then(d => {
        if (!ignore) {
          setData(d)
          setError(undefined)
        }
      })
      .catch(e => {
        if (!ignore) {
          setError(e)
          setData(undefined)
        }
      })
      .finally(() => {
        if (!ignore) {
          setIsLoading(false)
        }
      })
    return () => {
      ignore = true
    }
  }, [category])

  // 根据 data 和 error 返回 JSX
}
```

> 如果你好奇 `fetch` 为何如此设计，可以阅读 [为什么 Fetch Promise 在错误响应上不会 Reject?](https://kettanaito.com/blog/why-fetch-promise-doesnt-reject-on-error-responses)。


---

“我们只想获取个数据，怎么会这么难？”, 原本只是个简单的 `useEffect` 钩子，一旦需要考虑各种边界情况和状态管理，就变成了一团巨大的意大利面代码 🍝。那么，这里的核心观点是什么？

**数据获取本身很简单，但异步状态管理并不简单。**

这正是 `TanStack Query` 的价值所在。`TanStack Query` 并非一个数据获取库——它是一个**异步状态管理器**。所以，当你认为不需要用它来处理简单的数据获取时，你没错：即使使用 `TanStack Query`，你仍然需要编写相同的 `fetch` 代码。

但你仍然需要它，因为它能让你以可预测的方式，轻松地在应用中管理这些状态。老实说，在我使用 `TanStack Query` 之前，我也没有写过那个 `ignore` 布尔值标记的代码，很可能你也没有。😉

使用 `TanStack Query`，上面的代码可以简化为：

```tsx
const { data, isLoading, error } = useQuery({
  queryKey: ['bookmarks', category],
  queryFn: () => fetch(`${endpoint}/${category}`).then(res => {
    if (!res.ok) {
      throw new Error('Failed to fetch')
    }
    return res.json()
  })
})
```

这大约是之前意大利面代码的一半，甚至和最初那个有缺陷的代码片段长度相当。是的，它自动解决了我们发现的全部问题：

![](https://neptune-ipc.oss-cn-shenzhen.aliyuncs.com/img/20251226171502397.png)


1. 🏎️ 由于状态始终与它的输入（`category`）关联存储，竞态条件不复存在。
2. 🕐 你可以免费获得 `isLoading`、`data` 和 `error` 状态，并且在类型层面上是区分开的。
3. 🗑️ 空状态被清晰分离，并且可以通过 `placeholderData` 等功能进一步优化。
4. 🔄 除非你明确启用，否则你不会从先前的分类中获取到残留的数据或错误。
5. 🔥 重复请求（包括由 StrictMode 触发的）会被高效地合并。

除此之外，`TanStack Query` 还提供了大量开箱即用的功能，例如：

- 智能缓存
- 并发控制
- 高级错误处理
- 自动重试
- 自动刷新
- 自动更新
- 乐观更新
- 分页处理
- 无限滚动加载
- 窗口焦点时重新获取
- 滚动位置恢复
- 服务端渲染与注水（Hydration）

最重要的是，**TanStack Query 可以替代绝大部分需要使用 `Redux`、`MobX`、`Zustand` 等客户端状态库来管理状态的场景。**

![](https://neptune-ipc.oss-cn-shenzhen.aliyuncs.com/img/20251226171706239.png)


## 额外奖励的 Bug/功能：取消请求 🚨

或许是个 bug，或许是一个缺失的功能， 但是我敢打赌，如果测试不提这个问题，你很可能不会主动去考虑取消请求这个场景。

取消请求是一个非常常见的场景。比如用户在滚动列表时，突然停止滚动，当前页面的数据还没有返回，又进入到了下个页面， 等等。。。我们希望取消正在进行的请求，以免浪费资源。

fetch 需要借助 `AbortController` 来实现取消请求， 所以我们需要手动创建一个 `AbortController` 实例，并将其传递给 `fetch` 请求， 并且你还可能需要  `Redux`  `Zustand` 等状态管理库来维护一个存放全局请求的 `AbortController` 实例的对象 ， 以便在组件卸载时能够取消对应的请求。

而在 `TanStack Query` 中，你只需获取  queryFn 的参数 `signal`， 然后将其传递给 `fetch` 请求， 就可以实现取消请求。

```tsx
const { data, isLoading, error } = useQuery({
  queryKey: ['bookmarks', category],
  // 添加 signal 参数
  queryFn: ({ signal }) => fetch(`${endpoint}/${category}`, { signal }).then(res => {
    if (!res.ok) {
      throw new Error('Failed to fetch')
    }
    return res.json()
  })
})
```

## 类似的工具库

除了 `TanStack Query`，类似的库还有：

- [SWR：Vercel 出品的轻量级现代数据获取库](https://swr.vercel.app/)
- [Apollo GraphQL：GraphQL 状态管理库](https://www.apollographql.com/docs/)
- [RTK Query：基于 Redux 的现代数据获取库](https://redux-toolkit.js.org/rtk-query/overview)

真的不尝试一下 `TanStack Query` 吗？ 或者你也可以试一下更轻量级的 [SWR](https://swr.vercel.app/)。

---

公众号会持续输出，欢迎关注。
如果对你有帮助，欢迎点赞、收藏、关注。
![](https://neptune-ipc.oss-cn-shenzhen.aliyuncs.com/img/%E6%89%AB%E7%A0%81_%E6%90%9C%E7%B4%A2%E8%81%94%E5%90%88%E4%BC%A0%E6%92%AD%E6%A0%B7%E5%BC%8F-%E7%99%BD%E8%89%B2%E7%89%88.png)
