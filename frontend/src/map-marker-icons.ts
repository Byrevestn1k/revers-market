import { avatarInitials, type MapNode } from './map-clusters'
import { unitLabel } from './listing-options'

export function mapMarkerLabel(node: MapNode): string {
    const item = node.items[0], count = node.items.length
    const noun = new Set(node.items.map((point) => point.kind)).size > 1 ? 'оголошень' : item.kind === 'product' ? 'товарів' : 'запитів'
    if (node.type === 'cluster') return `${count} ${noun} поруч. Натисніть, щоб роздивитися.`
    if (node.type === 'seller') return `${item.owner?.nickname || item.owner?.username || 'Користувач'} · ${count} ${noun} за вашим пошуком. Відкрити оголошення.`
    const price = item.price ? ` · ${new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 }).format(item.price.amount)} ${item.price.currency}${item.unit ? ' / ' + unitLabel(item.unit) : ''}` : ''
    return `${item.kind === 'buyRequest' ? 'Шукає: ' : ''}${item.title}${price} · ${item.category.name} · ${item.owner?.nickname || item.owner?.username || ''}`
}

/** Build DOM nodes rather than interpolate listing/user text into HTML. */
export function mapMarkerElement(node: MapNode, resolveUrl: (url: string) => string): HTMLElement {
    const element = document.createElement('div'), item = node.items[0]
    element.className = `map-pin map-pin-${node.preview} ${item.kind === 'buyRequest' ? 'map-pin-request' : ''}`
    element.dataset.kind = node.type
    // Explicit dimensions also protect the image from inherited map/global styles.
    element.style.width = `${node.size}px`
    element.style.height = `${node.size}px`
    const categoryImage = () => {
        const image = document.createElement('span'), index = Math.max(0, Math.min(19, item.category.imageIndex ?? 18))
        image.className = 'map-pin-category'
        image.style.backgroundPosition = `${(index % 5) * 25}% ${Math.floor(index / 5) * 100 / 3}%`
        return image
    }
    const avatarFallback = () => {
        const avatar = document.createElement('span')
        avatar.className = 'map-pin-initials'
        avatar.textContent = avatarInitials(item.owner)
        const hue = [...(item.owner?.id ?? item.id)].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 360
        avatar.style.backgroundColor = `hsl(${hue} 35% 89%)`
        return avatar
    }
    if (node.preview === 'count') {
        const count = document.createElement('strong')
        count.textContent = String(node.items.length); element.append(count)
    } else {
        const media = document.createElement('span')
        media.className = 'map-pin-media'
        const url = node.preview === 'avatar' ? item.owner?.avatarUrl : node.preview === 'photo' ? item.photoUrl : null
        if (url) {
            const image = document.createElement('img')
            image.src = resolveUrl(url); image.alt = ''; image.decoding = 'async'
            image.addEventListener('error', () => image.replaceWith(node.preview === 'avatar' ? avatarFallback() : categoryImage()), { once: true })
            media.append(image)
        } else media.append(node.preview === 'avatar' ? avatarFallback() : categoryImage())
        element.append(media)
        if (node.preview === 'avatar') {
            const count = document.createElement('strong')
            count.className = 'map-pin-badge'; count.textContent = String(node.items.length); element.append(count)
        }
    }
    return element
}
