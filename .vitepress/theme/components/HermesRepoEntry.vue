<script setup lang="ts">
const items = [
	{
		title: "产品介绍",
		description: "核心能力、适用场景与工具链关系",
		link: "/hermes-repo/01-product-intro",
	},
	{
		title: "上手指南",
		description: "从克隆仓库到创建第一个项目",
		link: "/hermes-repo/02-getting-started",
	},
	{
		title: "团队管理",
		description: "团队、项目与成员权限配置",
		link: "/hermes-repo/03-team-management",
	},
];
</script>

<template>
	<section class="hermes-repo-entry">
		<div class="container">
			<div class="header">
				<div class="badge">Featured</div>
				<h2 class="title">Hermes Repo</h2>
				<p class="subtitle">
					面向团队的 AI Agent 工程化协作平台，统一项目规范、工程记忆与团队协作。
				</p>
				<a class="main-link" href="/hermes-repo/01-product-intro">查看全部文档 →</a>
			</div>
			<div class="grid">
				<a
					v-for="item in items"
					:key="item.link"
					class="card"
					:href="item.link"
				>
					<h3 class="card-title">{{ item.title }}</h3>
					<p class="card-desc">{{ item.description }}</p>
				</a>
			</div>
		</div>
	</section>
</template>

<style scoped>
.hermes-repo-entry {
	padding: 48px 24px 8px;
}

.container {
	max-width: 1152px;
	margin: 0 auto;
	padding: 28px 28px 24px;
	border: 1px solid var(--vp-c-divider);
	border-radius: 16px;
	background: linear-gradient(
		135deg,
		var(--vp-c-brand-soft) 0%,
		var(--vp-c-bg-soft) 55%
	);
}

.header {
	margin-bottom: 24px;
}

.badge {
	display: inline-block;
	margin-bottom: 12px;
	padding: 4px 10px;
	border-radius: 999px;
	font-size: 12px;
	font-weight: 600;
	color: var(--vp-c-brand-1);
	background: var(--vp-c-bg);
	border: 1px solid var(--vp-c-brand-soft);
}

.title {
	margin: 0 0 8px;
	font-size: 28px;
	font-weight: 700;
	line-height: 1.2;
	color: var(--vp-c-text-1);
}

.subtitle {
	margin: 0 0 16px;
	max-width: 720px;
	font-size: 15px;
	line-height: 1.6;
	color: var(--vp-c-text-2);
}

.main-link {
	font-size: 14px;
	font-weight: 600;
	color: var(--vp-c-brand-1);
	text-decoration: none;
}

.main-link:hover {
	color: var(--vp-c-brand-2);
}

.grid {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 16px;
}

.card {
	display: block;
	padding: 18px 20px;
	border: 1px solid var(--vp-c-divider);
	border-radius: 12px;
	background: var(--vp-c-bg);
	text-decoration: none;
	transition:
		border-color 0.2s,
		transform 0.2s,
		box-shadow 0.2s;
}

.card:hover {
	border-color: var(--vp-c-brand-1);
	transform: translateY(-2px);
	box-shadow: 0 8px 24px rgba(0, 0, 0, 0.06);
}

.card-title {
	margin: 0 0 8px;
	font-size: 16px;
	font-weight: 600;
	color: var(--vp-c-text-1);
}

.card-desc {
	margin: 0;
	font-size: 13px;
	line-height: 1.5;
	color: var(--vp-c-text-2);
}

@media (max-width: 768px) {
	.grid {
		grid-template-columns: 1fr;
	}

	.title {
		font-size: 24px;
	}
}
</style>
