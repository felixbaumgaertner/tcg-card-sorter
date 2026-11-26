<script lang="ts">
	import { resolve } from '$app/paths';
	import { cards, sets } from '../lib/cards';

	const perSet = sets.map((set) => ({
		...set,
		count: cards.filter((c) => c.set === set.id).length
	}));
</script>

<svelte:head>
	<title>Card Sorter</title>
</svelte:head>

<main>
	<h1>Card Sorter</h1>
	<p>Project skeleton. Nothing sorts yet.</p>
	<p><a href={resolve('/ocr-test')}>Reader test: can this phone read a card's code?</a></p>
	<p>The built-in card list is loaded:</p>
	<table>
		<thead>
			<tr><th>Set</th><th>Name</th><th>Released</th><th>Cards</th></tr>
		</thead>
		<tbody>
			{#each perSet as set (set.id)}
				<tr><td>{set.id}</td><td>{set.name}</td><td>{set.published}</td><td>{set.count}</td></tr>
			{/each}
		</tbody>
		<tfoot>
			<tr><td colspan="3">Total</td><td>{cards.length}</td></tr>
		</tfoot>
	</table>
</main>

<style>
	main {
		max-width: 40rem;
		margin: 0 auto;
		padding: 1.5rem 1rem;
		font-family: system-ui, sans-serif;
		line-height: 1.5;
	}
	table {
		width: 100%;
		border-collapse: collapse;
	}
	th,
	td {
		text-align: left;
		padding: 0.4rem 0.5rem;
		border-bottom: 1px solid color-mix(in srgb, currentColor 20%, transparent);
	}
	td:last-child,
	th:last-child {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	tfoot td {
		font-weight: 600;
	}
</style>
