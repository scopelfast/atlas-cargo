// Sistema de Skeleton Loading
// Melhora feedback visual durante carregamento de dados
// Versão: 1.0

/**
 * Criar skeleton loader para uma lista de itens
 * @param {number} count - Número de itens skeleton
 * @param {string} type - Tipo: 'grid', 'list', 'table'
 * @returns {string} HTML do skeleton
 */
function createSkeletonLoader(count = 3, type = 'grid') {
  const skeletons = [];
  
  for (let i = 0; i < count; i++) {
    if (type === 'grid') {
      skeletons.push(`
        <div class="skeleton-item skeleton-grid">
          <div class="skeleton-header">
            <div class="skeleton-line skeleton-title"></div>
            <div class="skeleton-line skeleton-subtitle"></div>
          </div>
          <div class="skeleton-body">
            <div class="skeleton-line"></div>
            <div class="skeleton-line"></div>
            <div class="skeleton-line skeleton-short"></div>
          </div>
          <div class="skeleton-footer">
            <div class="skeleton-button"></div>
            <div class="skeleton-button"></div>
          </div>
        </div>
      `);
    } else if (type === 'list') {
      skeletons.push(`
        <div class="skeleton-item skeleton-list">
          <div class="skeleton-avatar"></div>
          <div class="skeleton-content">
            <div class="skeleton-line skeleton-title"></div>
            <div class="skeleton-line"></div>
            <div class="skeleton-line skeleton-short"></div>
          </div>
        </div>
      `);
    } else if (type === 'table') {
      skeletons.push(`
        <tr class="skeleton-item skeleton-table">
          <td><div class="skeleton-line"></div></td>
          <td><div class="skeleton-line"></div></td>
          <td><div class="skeleton-line"></div></td>
          <td><div class="skeleton-line skeleton-short"></div></td>
          <td><div class="skeleton-button-small"></div></td>
        </tr>
      `);
    }
  }
  
  return skeletons.join('');
}

/**
 * Mostrar skeleton loader em um container
 * @param {string|HTMLElement} container - ID ou elemento HTML
 * @param {number} count - Número de itens
 * @param {string} type - Tipo de skeleton
 */
function showSkeleton(container, count = 3, type = 'grid') {
  const element = typeof container === 'string' 
    ? document.getElementById(container) || document.querySelector(container)
    : container;
  
  if (!element) {
    console.warn('Container não encontrado para skeleton:', container);
    return;
  }
  
  element.innerHTML = `
    <div class="skeleton-container">
      ${createSkeletonLoader(count, type)}
    </div>
  `;
}

/**
 * Esconder skeleton loader
 * @param {string|HTMLElement} container - ID ou elemento HTML
 */
function hideSkeleton(container) {
  const element = typeof container === 'string' 
    ? document.getElementById(container) || document.querySelector(container)
    : container;
  
  if (!element) return;
  
  const skeletonContainer = element.querySelector('.skeleton-container');
  if (skeletonContainer) {
    skeletonContainer.remove();
  }
}

// Injetar estilos CSS se ainda não existirem
if (!document.getElementById('skeleton-loader-styles')) {
  const styles = document.createElement('style');
  styles.id = 'skeleton-loader-styles';
  styles.textContent = `
    /* Skeleton Container */
    .skeleton-container {
      display: grid;
      gap: 15px;
      padding: 20px 0;
    }
    
    /* Skeleton Item */
    .skeleton-item {
      background: #f8f9fa;
      border-radius: 8px;
      padding: 15px;
      animation: skeleton-pulse 1.5s ease-in-out infinite;
    }
    
    @keyframes skeleton-pulse {
      0%, 100% {
        opacity: 1;
      }
      50% {
        opacity: 0.6;
      }
    }
    
    /* Skeleton Grid */
    .skeleton-grid {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    
    .skeleton-header {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    
    .skeleton-body {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 10px 0;
    }
    
    .skeleton-footer {
      display: flex;
      gap: 10px;
      margin-top: auto;
      padding-top: 12px;
      border-top: 1px solid #e9ecef;
    }
    
    /* Skeleton List */
    .skeleton-list {
      display: flex;
      gap: 15px;
      align-items: flex-start;
    }
    
    .skeleton-avatar {
      width: 50px;
      height: 50px;
      border-radius: 50%;
      background: linear-gradient(90deg, #e9ecef 25%, #f8f9fa 50%, #e9ecef 75%);
      background-size: 200% 100%;
      animation: skeleton-shimmer 1.5s ease-in-out infinite;
      flex-shrink: 0;
    }
    
    .skeleton-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    
    /* Skeleton Table */
    .skeleton-table {
      height: 50px;
    }
    
    .skeleton-table td {
      padding: 12px;
    }
    
    /* Skeleton Lines */
    .skeleton-line {
      height: 12px;
      background: linear-gradient(90deg, #e9ecef 25%, #f8f9fa 50%, #e9ecef 75%);
      background-size: 200% 100%;
      animation: skeleton-shimmer 1.5s ease-in-out infinite;
      border-radius: 4px;
    }
    
    @keyframes skeleton-shimmer {
      0% {
        background-position: 200% 0;
      }
      100% {
        background-position: -200% 0;
      }
    }
    
    .skeleton-title {
      height: 16px;
      width: 70%;
    }
    
    .skeleton-subtitle {
      height: 12px;
      width: 50%;
    }
    
    .skeleton-short {
      width: 40%;
    }
    
    /* Skeleton Buttons */
    .skeleton-button {
      width: 80px;
      height: 32px;
      background: linear-gradient(90deg, #e9ecef 25%, #f8f9fa 50%, #e9ecef 75%);
      background-size: 200% 100%;
      animation: skeleton-shimmer 1.5s ease-in-out infinite;
      border-radius: 6px;
    }
    
    .skeleton-button-small {
      width: 60px;
      height: 28px;
      background: linear-gradient(90deg, #e9ecef 25%, #f8f9fa 50%, #e9ecef 75%);
      background-size: 200% 100%;
      animation: skeleton-shimmer 1.5s ease-in-out infinite;
      border-radius: 4px;
    }
    
    /* Grid Layout para Skeleton Grid */
    .skeleton-container:has(.skeleton-grid) {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 20px;
    }
    
    /* List Layout para Skeleton List */
    .skeleton-container:has(.skeleton-list) {
      display: flex;
      flex-direction: column;
      gap: 15px;
    }
  `;
  
  document.head.appendChild(styles);
}

// Expor funções globalmente
window.showSkeleton = showSkeleton;
window.hideSkeleton = hideSkeleton;
window.createSkeletonLoader = createSkeletonLoader;
