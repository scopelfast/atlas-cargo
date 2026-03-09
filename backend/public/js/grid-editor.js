/**
 * Grid Editor Component
 * Componente reutilizável para exibir dados em grid com edição em linha
 * 
 * Uso:
 * const grid = new GridEditor({
 *   container: '#lista',
 *   columns: [
 *     { field: 'id', header: 'ID', editable: false, width: '60px' },
 *     { field: 'name', header: 'Nome', editable: true, type: 'text' }
 *   ],
 *   apiEndpoint: '/api/viagens',
 *   onEdit: async (id, updatedData) => { ... },
 *   onDelete: async (id) => { ... }
 * });
 * 
 * grid.render(data);
 */

// Verificar se já foi carregado para evitar erro de declaração duplicada
if (typeof window === 'undefined' || typeof window.GridEditor === 'undefined') {
  // Aplicar mensagem padrão global para confirmação de exclusão.
  // Módulos e o próprio GridEditor podem sobrescrever definindo `window.APP_CONFIRM_DELETE_MESSAGE`.
  try {
    if (typeof window !== 'undefined' && typeof window.APP_CONFIRM_DELETE_MESSAGE === 'undefined') {
      window.APP_CONFIRM_DELETE_MESSAGE = 'Tem certeza que deseja desativar esta situação?';
    }
  } catch (e) {}

  class GridEditor {
  constructor(options = {}) {
    this.container = typeof options.container === 'string' 
  ? document.querySelector(options.container) 
  : options.container;
    
    this.columns = options.columns || [];
    this.apiEndpoint = options.apiEndpoint || '';
    this.onEdit = options.onEdit || this.defaultEdit.bind(this);
    this.onDelete = options.onDelete || this.defaultDelete.bind(this);
    this.onBeforeEdit = options.onBeforeEdit || (() => true);
    this.onAfterEdit = options.onAfterEdit || (() => {});
    this.customActions = options.customActions || null; // Função que retorna HTML para ações customizadas
    this.data = [];
    this.editingId = null;
    this.originalData = null;
    this.showActions = options.showActions !== false;
    this.autoSave = options.autoSave !== false;
    this.batchSize = options.batchSize || 50;
    
    // Ordenação
    this.sortField = null;
    this.sortDirection = null; // 'asc' ou 'desc'
    
    this.init();
  }

  init() {
    if (!this.container) {
      console.error('GridEditor: Container não encontrado');
      return;
    }
    
    // Verificar se já existe um listener (evitar duplicação)
    if (this._clickListenerAttached) {
      return;
    }
    this._clickListenerAttached = true;
    
    // Configurar event listeners delegados para os botões de ação
    this.container.addEventListener('click', (e) => {
      // Tentar encontrar o botão de várias formas (pode ser o próprio elemento ou um filho)
      let btn = e.target.closest('.grid-btn-edit, .grid-btn-delete, .grid-btn-save, .grid-btn-cancel');
      
      // Se não encontrou, verificar se o target é o próprio botão
      if (!btn) {
        if (e.target.classList.contains('grid-btn-edit') || 
            e.target.classList.contains('grid-btn-delete') ||
            e.target.classList.contains('grid-btn-save') ||
            e.target.classList.contains('grid-btn-cancel')) {
          btn = e.target;
        }
      }
      
      // Se ainda não encontrou, verificar se o target está dentro de um botão
      if (!btn && e.target.parentElement) {
        const parent = e.target.parentElement;
        if (parent.classList.contains('grid-btn-edit') || 
            parent.classList.contains('grid-btn-delete') ||
            parent.classList.contains('grid-btn-save') ||
            parent.classList.contains('grid-btn-cancel')) {
          btn = parent;
        }
      }
      
      if (!btn) return;
      
      const row = btn.closest('[data-grid-id]');
      if (!row) {
        console.warn('[GridEditor] Linha não encontrada para o botão:', btn);
        return;
      }
      
      const id = row.getAttribute('data-grid-id');
      
      // Validar ID antes de prosseguir
      if (!id || id === 'undefined' || id === 'null' || id === '') {
        console.error('[GridEditor] ID inválido do atributo data-grid-id:', id, 'Row:', row);
        return;
      }
      
      e.preventDefault();
      e.stopPropagation();
      
      if (btn.classList.contains('grid-btn-edit')) {
        this.enterEditMode(id);
      } else if (btn.classList.contains('grid-btn-delete')) {
        this.requestDelete(id);
      } else if (btn.classList.contains('grid-btn-save')) {
        this.saveEdit();
      } else if (btn.classList.contains('grid-btn-cancel')) {
        this.cancelEdit();
      }
    });
    
    // Suporte para atalhos de teclado
    this.container.addEventListener('keydown', (e) => {
      if (this.editingId === null) return;
      
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        this.saveEdit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.cancelEdit();
      }
    });
  }

  render(data = []) {
    if (!this.container) {
      console.error('GridEditor: Container não encontrado');
      return;
    }
    
    this.data = Array.isArray(data) ? data : [];
    
    if (this.data.length === 0) {
      this.container.innerHTML = '<p class="empty">Nenhum registro encontrado.</p>';
      return;
    }
    
    // Ordenar dados se houver ordenação ativa
    const sortedData = this.getSortedData();
    
    const visibleColumns = this.columns.filter(col => !col.hidden);
    const html = `
      <table class="grid-table">
        <thead>
          <tr>
            ${visibleColumns.map(col => this.renderHeader(col)).join('')}
            ${this.showActions ? '<th class="grid-actions-header grid-col-right">Ações</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${sortedData.map(row => this.renderRow(row)).join('')}
        </tbody>
      </table>
    `;
    
    this.container.innerHTML = html;
    
    // Adicionar event listeners para ordenação
    this.attachSortListeners();
  }
  
  renderHeader(col) {
    // Por padrão, todas as colunas são ordenáveis, exceto se explicitamente desabilitado
    // Colunas editáveis também podem ser ordenadas se sortable: true for especificado
    const isSortable = col.sortable !== false; // true por padrão, a menos que seja false explicitamente
    const isSorted = this.sortField === col.field;
    const sortIcon = isSorted 
      ? (this.sortDirection === 'asc' ? '↑' : '↓')
      : '';
    const sortClass = isSorted ? `sort-${this.sortDirection}` : '';
    const cursorStyle = isSortable ? 'cursor: pointer;' : '';
    const alignRight = col.align === 'right';
    const alignClass = alignRight ? ' grid-col-right' : '';
    // Só colunas align right ficam "justas" (min/max iguais). Outras usam width só como hint para não estourar a página.
    const widthStyle = col.width
      ? (alignRight ? `width: ${col.width}; min-width: ${col.width}; max-width: ${col.width};` : `width: ${col.width};`)
      : '';
    
    return `<th 
      style="${widthStyle} ${cursorStyle}" 
      class="grid-header ${sortClass}${alignClass}"
      data-field="${col.field}"
      data-sortable="${isSortable}"
      title="${isSortable ? 'Clique para ordenar' : ''}"
    >
      ${col.header || col.field} ${sortIcon ? `<span class="sort-icon">${sortIcon}</span>` : ''}
    </th>`;
  }
  
  attachSortListeners() {
    const headers = this.container.querySelectorAll('th[data-sortable="true"]');
    headers.forEach(header => {
      header.addEventListener('click', (e) => {
        const field = header.getAttribute('data-field');
        if (field) {
          this.sortBy(field);
        }
      });
    });
  }
  
  sortBy(field) {
    // Se já está ordenando por este campo, inverter direção
    if (this.sortField === field) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      // Nova ordenação, começar com ascendente
      this.sortField = field;
      this.sortDirection = 'asc';
    }
    
    // Re-renderizar com dados ordenados
    this.render(this.data);
  }
  
  getSortedData() {
    if (!this.sortField) {
      return [...this.data];
    }
    
    const sorted = [...this.data].sort((a, b) => {
      const aVal = this.getNestedValue(a, this.sortField);
      const bVal = this.getNestedValue(b, this.sortField);
      
      // Tratar valores nulos/undefined - colocar no final
      if (aVal === null || aVal === undefined) {
        if (bVal === null || bVal === undefined) return 0;
        return 1; // a vai para o final
      }
      if (bVal === null || bVal === undefined) {
        return -1; // b vai para o final
      }
      
      // Tentar converter para número se ambos parecem numéricos
      const aNum = typeof aVal === 'number' ? aVal : (isNaN(Number(aVal)) ? null : Number(aVal));
      const bNum = typeof bVal === 'number' ? bVal : (isNaN(Number(bVal)) ? null : Number(bVal));
      
      // Comparação numérica se ambos são números
      if (aNum !== null && bNum !== null) {
        return this.sortDirection === 'asc' ? aNum - bNum : bNum - aNum;
      }
      
      // Comparação de strings (case-insensitive)
      const aStr = String(aVal).toLowerCase().trim();
      const bStr = String(bVal).toLowerCase().trim();
      
      if (aStr < bStr) return this.sortDirection === 'asc' ? -1 : 1;
      if (aStr > bStr) return this.sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    
    return sorted;
  }

  renderRow(row) {
    const id = this.getRowId(row);
    
    // Se não houver ID válido, não renderizar a linha
    if (id === null || id === undefined) {
      console.warn('[GridEditor] Linha ignorada por falta de ID:', row);
      return '';
    }
    
    const isEditing = String(this.editingId) === String(id);
    
    const visibleColumns = this.columns.filter(col => !col.hidden);
    return `
      <tr class="grid-row ${isEditing ? 'editing' : ''}" data-grid-id="${id}">
        ${visibleColumns.map(col => this.renderCell(row, col, isEditing)).join('')}
        ${this.showActions ? `<td class="grid-actions grid-col-right">${this.renderActions(row, isEditing)}</td>` : ''}
      </tr>
    `;
  }

  renderCell(row, col, isEditing) {
    const value = this.getNestedValue(row, col.field);
    const isEditableCell = col.editable && isEditing;
    
    if (isEditableCell) {
      return this.renderEditableCell(row, col, value);
    }
    
    const alignClass = col.align === 'right' ? ' grid-col-right' : '';
    return `
      <td class="grid-cell${alignClass}" data-field="${col.field}">
        <span class="cell-value">${this.formatCellValue(value, col)}</span>
      </td>
    `;
  }

  renderEditableCell(row, col, value) {
    const inputId = `grid-input-${this.getRowId(row)}-${col.field}`;
    let inputHtml = '';
    
    switch (col.type) {
      case 'select':
        inputHtml = `
          <select id="${inputId}" class="grid-input" data-field="${col.field}">
            ${(col.options || []).map(opt => 
              `<option value="${opt.value}" ${opt.value === value ? 'selected' : ''}>${opt.label}</option>`
            ).join('')}
          </select>
        `;
        break;
      
      case 'number':
        inputHtml = `
          <input type="number" id="${inputId}" class="grid-input" data-field="${col.field}" value="${value || ''}" step="${col.step || '0.01'}">
        `;
        break;
      
      case 'date':
        inputHtml = `
          <input type="date" id="${inputId}" class="grid-input" data-field="${col.field}" value="${value || ''}">
        `;
        break;
      
      case 'datetime-local':
        const dateTimeValue = this.formatDateTimeForInput(value);
        inputHtml = `
          <input type="datetime-local" id="${inputId}" class="grid-input" data-field="${col.field}" value="${dateTimeValue || ''}">
        `;
        break;
      
      default:
        inputHtml = `
          <input type="text" id="${inputId}" class="grid-input" data-field="${col.field}" value="${value || ''}" maxlength="${col.maxlength || '255'}">
        `;
    }
    
    const alignClass = col.align === 'right' ? ' grid-col-right' : '';
    return `
      <td class="grid-cell editing${alignClass}" data-field="${col.field}">
        ${inputHtml}
      </td>
    `;
  }

  renderActions(row, isEditing) {
    if (isEditing) {
      return `
        <button type="button" class="btn grid-btn-save" title="Salvar (Ctrl+Enter)">✓</button>
        <button type="button" class="btn grid-btn-cancel" title="Cancelar (Esc)">✕</button>
      `;
    }
    
    let customActionsHtml = '';
    if (this.customActions && typeof this.customActions === 'function') {
      customActionsHtml = this.customActions(row);
    }
    
    return `
      <button type="button" class="btn grid-btn-edit" title="Editar">✎</button>
      <button type="button" class="btn grid-btn-delete" title="Excluir">🗑</button>
      ${customActionsHtml}
    `;
  }

  enterEditMode(id) {
    // Normalize id types to avoid string/number mismatches
    const targetId = String(id);

    // If there's a stale editingId (row removed or re-rendered), clear it
    if (this.editingId !== null) {
      const editingRowExists = !!this.container.querySelector(`[data-grid-id="${this.editingId}"]`);
      if (!editingRowExists) {
        this.editingId = null;
        this.originalData = null;
      }
    }

    if (this.editingId !== null) {
      // Compare as strings to avoid strict-type mismatches
      if (String(this.editingId) === targetId) {
        // Já estamos editando esta mesma linha — focar no primeiro campo editável
        const existingRow = this.container.querySelector(`[data-grid-id="${targetId}"]`);
        if (existingRow) {
          const firstInput = existingRow.querySelector('.grid-input');
          if (firstInput) {
            try { firstInput.focus(); } catch (e) { /* ignore */ }
          }
        }
        return;
      }

      if (!confirm('Existem alterações em andamento. Deseja descartá-las?')) {
        return;
      }
      this.cancelEdit();
    }
    
    // Support synchronous or asynchronous onBeforeEdit callbacks.
    // If onBeforeEdit returns a Promise, wait for it; if it resolves to false, cancel.
    const before = this.onBeforeEdit(id);
    
    const proceed = () => {
      // Encontrar row
      const row = this.container.querySelector(`[data-grid-id="${id}"]`);
      if (!row) return;
      
      // Guardar dados originais
      this.editingId = targetId;
      this.originalData = {};
      
      this.columns.filter(col => col.editable).forEach(col => {
        const cell = row.querySelector(`[data-field="${col.field}"]`);
        if (cell) {
          this.originalData[col.field] = cell.textContent || cell.innerText;
        }
      });
      
      // Re-renderizar apenas a linha em modo edição
      const rowData = this.data.find(r => String(this.getRowId(r)) === String(id));
      if (rowData) {
        const visibleCols = this.columns.filter(col => !col.hidden);
        row.innerHTML = `
          ${visibleCols.map(col => this.renderCell(rowData, col, true)).join('')}
          ${this.showActions ? `<td class="grid-actions grid-col-right">${this.renderActions(rowData, true)}</td>` : ''}
        `;
        row.classList.add('editing');
        
        // Focar no primeiro campo editável
        const firstInput = row.querySelector('.grid-input');
        if (firstInput) {
          setTimeout(() => firstInput.focus(), 0);
        }
      }
    };
    
    if (before && typeof before.then === 'function') {
      before.then(result => {
        if (result === false) return;
        proceed();
      }).catch(err => {
        console.error('[GridEditor] onBeforeEdit error', err);
      });
    } else {
      if (before === false) return;
      proceed();
    }
  }

  async saveEdit() {
    if (this.editingId === null) return;
    
    const row = this.container.querySelector(`[data-grid-id="${this.editingId}"]`);
    if (!row) return;
    
    // Coletar dados editados
    const updatedData = {};
    this.columns.filter(col => col.editable).forEach(col => {
      const input = row.querySelector(`[data-field="${col.field}"]`);
      if (input) {
        updatedData[col.field] = input.value;
      }
    });
    
    try {
      // Garantir campos esperados pelo backend
      let rowData = this.data.find(r => String(this.getRowId(r)) === String(this.editingId));
      // Se FGACTIVE não foi enviado (por algum motivo), preencher com valor atual
      if (typeof updatedData.FGACTIVE === 'undefined') {
        if (rowData && typeof rowData.FGACTIVE !== 'undefined') updatedData.FGACTIVE = rowData.FGACTIVE;
        else updatedData.FGACTIVE = 'S';
      }
      // Verificar descrição
      if (!updatedData.DSSITUACAOVIAGEM || !String(updatedData.DSSITUACAOVIAGEM).trim()) {
        alert('Descrição é obrigatória.');
        return;
      }

      // Chamar callback de edição
      await this.onEdit(this.editingId, updatedData);
      
      // Atualizar data local
      rowData = this.data.find(r => String(this.getRowId(r)) === String(this.editingId));
      if (rowData) {
        Object.assign(rowData, updatedData);
      }
      
      this.onAfterEdit(this.editingId, updatedData);
      this.cancelEdit();
      
      // Re-renderizar a linha em modo visualização
      if (rowData) {
        const visibleCols = this.columns.filter(col => !col.hidden);
        row.innerHTML = `
          ${visibleCols.map(col => this.renderCell(rowData, col, false)).join('')}
          ${this.showActions ? `<td class="grid-actions grid-col-right">${this.renderActions(rowData, false)}</td>` : ''}
        `;
      }
      
    } catch (err) {
      console.error('Erro ao salvar:', err);
      alert('Erro ao salvar alterações');
    }
  }

  cancelEdit() {
    if (this.editingId === null) return;
    
    const row = this.container.querySelector(`[data-grid-id="${this.editingId}"]`);
    const rowData = this.data.find(r => String(this.getRowId(r)) === String(this.editingId));
    
    if (row && rowData) {
      const visibleCols = this.columns.filter(col => !col.hidden);
      row.innerHTML = `
        ${visibleCols.map(col => this.renderCell(rowData, col, false)).join('')}
        ${this.showActions ? `<td class="grid-actions grid-col-right">${this.renderActions(rowData, false)}</td>` : ''}
      `;
    }
    
    this.editingId = null;
    this.originalData = null;
  }

  requestDelete(id) {
    // Validar ID antes de prosseguir
    if (!id || id === 'undefined' || id === 'null' || id === '' || String(id).trim() === '') {
      console.error('[GridEditor] ID inválido para exclusão:', id);
      alert('Erro: ID não disponível para exclusão.');
      return;
    }
    
    // Converter ID para string para garantir consistência
    const idStr = String(id).trim();
    
    // Se onDelete foi sobrescrito (customizado), chamar diretamente
    // O módulo que configurou onDelete é responsável por mostrar o modal
    // Verificar se onDelete foi customizado comparando com a referência do defaultDelete
    const isCustomDelete = this.onDelete && this.onDelete.toString() !== this.defaultDelete.toString();
    
    if (isCustomDelete) {
      try {
        // Chamar onDelete com o ID garantindo que seja passado corretamente
        const result = this.onDelete.call(this, idStr);
        // Se retornar uma Promise, aguardar
        if (result && typeof result.then === 'function') {
          result.catch(err => console.error('[GridEditor] Erro no onDelete customizado:', err));
        }
      } catch (err) {
        console.error('[GridEditor] Erro ao chamar onDelete customizado:', err);
      }
      return;
    }
    
    // Se onDelete é o padrão, usar o modal ou confirm()
    const msg = (typeof window !== 'undefined' && typeof window.APP_CONFIRM_DELETE_MESSAGE !== 'undefined')
      ? window.APP_CONFIRM_DELETE_MESSAGE
      : 'Tem certeza que deseja desativar este registro?';
    
    // Usar modal formatado se disponível, senão fallback para confirm()
    const modalMessage = document.getElementById('modalMessage');
    const confirmYes = document.getElementById('confirmYes');
    const confirmNo = document.getElementById('confirmNo');
    const modalEl = document.getElementById('confirmModal');
    
    if (modalMessage && confirmYes && confirmNo && modalEl) {
      modalMessage.textContent = msg;
      
      // Armazenar o ID no modal para garantir que seja preservado
      modalEl.dataset.deleteId = idStr;
      
      // Remover event listeners anteriores para evitar acúmulo
      const newConfirmYes = confirmYes.cloneNode(true);
      const newConfirmNo = confirmNo.cloneNode(true);
      confirmYes.parentNode.replaceChild(newConfirmYes, confirmYes);
      confirmNo.parentNode.replaceChild(newConfirmNo, confirmNo);
      
      // Adicionar novos event listeners
      newConfirmYes.onclick = async () => {
        // Obter ID do modal (garantir que está disponível)
        const deleteId = modalEl.dataset.deleteId || idStr;
        
        // Validar ID novamente
        if (!deleteId || deleteId === 'undefined' || deleteId === 'null' || deleteId === '') {
          console.error('[GridEditor] ID inválido no momento da exclusão:', deleteId);
          alert('Erro: ID não disponível para exclusão.');
          modalEl.style.display = 'none';
          return;
        }
        
        try {
          await this.onDelete(deleteId);
        } catch (err) {
          console.error('[GridEditor] Erro ao executar onDelete:', err);
        }
        modalEl.style.display = 'none';
        // Limpar o ID armazenado
        delete modalEl.dataset.deleteId;
      };
      
      newConfirmNo.onclick = () => {
        modalEl.style.display = 'none';
        // Limpar o ID armazenado
        delete modalEl.dataset.deleteId;
      };
      
      modalEl.style.display = 'block';
    } else {
      // Fallback: usar confirm() nativo se modal não existir
      if (confirm(msg)) {
        this.onDelete(idStr);
      }
    }
  }

  async defaultEdit(id, updatedData) {
    // Implementação padrão - pode ser sobrescrita
    if (!this.apiEndpoint) {
      throw new Error('apiEndpoint não configurado');
    }
    
    const response = await fetch(`${this.apiEndpoint}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedData)
    });

    if (!response.ok) {
      let bodyText = '';
      try {
        const json = await response.json();
        bodyText = json.error || JSON.stringify(json);
      } catch (e) {
        try { bodyText = await response.text(); } catch (e2) { bodyText = ''; }
      }
      throw new Error(`Erro ${response.status}${bodyText ? ': ' + bodyText : ''}`);
    }

    return response.json();
  }

  async defaultDelete(id) {
    if (!this.apiEndpoint) {
      throw new Error('apiEndpoint não configurado');
    }
    
    const response = await fetch(`${this.apiEndpoint}/${id}`, {
      method: 'DELETE'
    });
    
    if (!response.ok) {
      throw new Error(`Erro ${response.status}`);
    }
    
    // Remover da lista local
    this.data = this.data.filter(r => this.getRowId(r) !== id);
    this.render(this.data);
    alert('Registro excluído com sucesso');
  }

  // Utilitários
  getRowId(row) {
    if (!row) return null;
    
    // Verificar qual campo é o ID
    const idColumn = this.columns.find(col => col.isId);
    const idField = idColumn?.field || this.columns[0]?.field || 'id';
    
    const id = row[idField] !== undefined ? row[idField] : (row.id !== undefined ? row.id : null);
    
    // Garantir que retornamos um valor válido (não undefined, null, ou string vazia)
    if (id === null || id === undefined || id === '') {
      console.warn('[GridEditor] ID inválido para linha:', row, 'campo:', idField);
      return null;
    }
    
    return id;
  }

  getNestedValue(obj, path) {
    return path.split('.').reduce((current, prop) => current?.[prop], obj);
  }

  formatCellValue(value, col) {
    if (value === null || value === undefined) return '-';
    
    if (col.type === 'date' || col.type === 'datetime-local') {
      if (!value) return '';
      
      // Parsear string diretamente sem conversão de fuso horário
      let str = String(value).trim();
      str = str.replace(/\.\d{3}/, ''); // Remover milissegundos
      
      const match = str.match(/(\d{4})-(\d{2})-(\d{2})[\sT](\d{2}):?(\d{2})?:?(\d{2})?/);
      if (match) {
        const [, year, month, day, hours = '00', minutes = '00'] = match;
        if (col.type === 'datetime-local') {
          return `${day}/${month}/${year} ${hours}:${minutes}`;
        }
        return `${day}/${month}/${year}`;
      }
      
      // Fallback - tratar string de data do SQL Server
      if (typeof value === 'string') {
        // Remover o Z se existir e tratar como data local
        let dataStr = value.replace('Z', '').replace('T', ' ');
        const match = dataStr.match(/(\d{4})-(\d{2})-(\d{2})[\s]?(\d{2}):?(\d{2})?:?(\d{2})?/);
        if (match) {
          const [, year, month, day] = match;
          const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
          if (!isNaN(date.getTime())) {
            return date.toLocaleDateString('pt-BR');
          }
        }
      }
      
      const date = new Date(value);
      if (isNaN(date.getTime())) return value;
      return date.toLocaleDateString('pt-BR');
    }
    
    if (col.type === 'number') {
      const decimal = col.decimal || 2;
      return parseFloat(value).toLocaleString('pt-BR', { 
        minimumFractionDigits: decimal,
        maximumFractionDigits: decimal
      });
    }
    
    if (col.format) {
      // Normalizar valor antes de passar para format (tratar null/undefined e espaços)
      const normalizedValue = value === null || value === undefined ? null : String(value).trim();
      return col.format(normalizedValue);
    }
    
    return String(value).substring(0, col.maxDisplay || 100);
  }

  formatDateTimeForInput(dateString) {
    if (!dateString) return '';
    
    // Se já está no formato correto (YYYY-MM-DDTHH:mm), retornar direto
    if (typeof dateString === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(dateString)) {
      return dateString.slice(0, 16);
    }
    
    // Parsear string no formato SQL Server: "2026-11-21 08:00:00" ou "2026-11-21T08:00:00"
    let str = String(dateString).trim();
    
    // Remover milissegundos se existirem
    str = str.replace(/\.\d{3}/, '');
    
    // Extrair componentes da data diretamente da string (sem conversão de fuso)
    const match = str.match(/(\d{4})-(\d{2})-(\d{2})[\sT](\d{2}):(\d{2}):?(\d{2})?/);
    if (match) {
      const [, ano, mes, dia, horas, minutos] = match;
      return `${ano}-${mes}-${dia}T${horas}:${minutos}`;
    }
    
    // Fallback: usar Date apenas se não conseguir parsear
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';
    
    // Ajustar para fuso horário local (compensar a diferença)
    const offset = date.getTimezoneOffset(); // diferença em minutos
    const dLocal = new Date(date.getTime() - (offset * 60 * 1000));
    
    const ano = dLocal.getFullYear();
    const mes = String(dLocal.getMonth() + 1).padStart(2, '0');
    const dia = String(dLocal.getDate()).padStart(2, '0');
    const horasLocal = String(dLocal.getHours()).padStart(2, '0');
    const minutosLocal = String(dLocal.getMinutes()).padStart(2, '0');
    return `${ano}-${mes}-${dia}T${horasLocal}:${minutosLocal}`;
  }

  // Métodos públicos adicionais
  updateRow(id, data) {
    const rowIndex = this.data.findIndex(r => String(this.getRowId(r)) === String(id));
    if (rowIndex !== -1) {
      this.data[rowIndex] = { ...this.data[rowIndex], ...data };
      this.render(this.data);
    }
  }

  deleteRow(id) {
    this.data = this.data.filter(r => this.getRowId(r) !== id);
    this.render(this.data);
  }

  addRow(data) {
    this.data.unshift(data);
    this.render(this.data);
  }

  refresh(data) {
    this.render(data);
  }
}

  // Expor globalmente para garantir disponibilidade em todos os módulos e carregamentos dinâmicos
  try {
    if (typeof window !== 'undefined') {
      window.GridEditor = GridEditor;
      window._gridEditorLoaded = true;
    }
  } catch (e) {
    try { console.error('[GridEditor] exposure error', e); } catch(err) {}
  }
}
