import os
import sqlite3
import json
from datetime import datetime
from flask import Flask, request, jsonify, render_template, send_file
import csv
import io

app = Flask(__name__)

# 数据库路径
DB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
DB_PATH = os.path.join(DB_DIR, 'leaf.db')

def get_db():
    """获取数据库连接"""
    os.makedirs(DB_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """初始化数据库表"""
    conn = get_db()
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS treatments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL
        );

        CREATE TABLE IF NOT EXISTS plants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            treatment TEXT NOT NULL,
            coef REAL NOT NULL DEFAULT 0.75,
            total_area REAL NOT NULL DEFAULT 0,
            leaf_count INTEGER NOT NULL DEFAULT 0,
            operator TEXT DEFAULT '',
            note TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS leaves (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            plant_id INTEGER NOT NULL,
            leaf_index INTEGER NOT NULL,
            length REAL NOT NULL,
            width REAL NOT NULL,
            area REAL NOT NULL,
            FOREIGN KEY (plant_id) REFERENCES plants(id) ON DELETE CASCADE
        );
    ''')

    # 插入默认处理
    for t in ['CK', 'N1', 'N2', 'N3']:
        try:
            conn.execute('INSERT INTO treatments (name) VALUES (?)', (t,))
        except sqlite3.IntegrityError:
            pass

    conn.commit()
    conn.close()

init_db()

# ==================== 页面 ====================

@app.route('/')
def index():
    return render_template('index.html')

# ==================== 处理组 API ====================

@app.route('/api/treatments', methods=['GET'])
def get_treatments():
    conn = get_db()
    rows = conn.execute('SELECT name FROM treatments ORDER BY id').fetchall()
    conn.close()
    return jsonify([r['name'] for r in rows])

@app.route('/api/treatments', methods=['POST'])
def add_treatment():
    data = request.json
    name = data.get('name', '').strip()
    if not name:
        return jsonify({'error': '名称不能为空'}), 400
    conn = get_db()
    try:
        conn.execute('INSERT INTO treatments (name) VALUES (?)', (name,))
        conn.commit()
    except sqlite3.IntegrityError:
        return jsonify({'error': '已存在'}), 400
    finally:
        conn.close()
    return jsonify({'ok': True})

@app.route('/api/treatments/<name>', methods=['DELETE'])
def del_treatment(name):
    conn = get_db()
    conn.execute('DELETE FROM treatments WHERE name = ?', (name,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})

# ==================== 株记录 API ====================

@app.route('/api/plants', methods=['GET'])
def get_plants():
    treat = request.args.get('treatment', '')
    conn = get_db()

    if treat and treat != '全部':
        plants = conn.execute(
            'SELECT * FROM plants WHERE treatment = ? ORDER BY id DESC', (treat,)
        ).fetchall()
    else:
        plants = conn.execute('SELECT * FROM plants ORDER BY id DESC').fetchall()

    result = []
    for p in plants:
        leaves = conn.execute(
            'SELECT * FROM leaves WHERE plant_id = ? ORDER BY leaf_index', (p['id'],)
        ).fetchall()
        result.append({
            'id': p['id'],
            'treatment': p['treatment'],
            'coef': p['coef'],
            'total_area': p['total_area'],
            'leaf_count': p['leaf_count'],
            'operator': p['operator'],
            'note': p['note'],
            'created_at': p['created_at'],
            'leaves': [{'l': lf['length'], 'w': lf['width'], 'area': lf['area']} for lf in leaves]
        })

    conn.close()
    return jsonify(result)

@app.route('/api/plants', methods=['POST'])
def add_plant():
    data = request.json
    treatment = data.get('treatment', '')
    coef = data.get('coef', 0.75)
    leaves_data = data.get('leaves', [])
    operator = data.get('operator', '')
    note = data.get('note', '')

    if not treatment or not leaves_data:
        return jsonify({'error': '数据不完整'}), 400

    total_area = sum(lf['l'] * lf['w'] * coef for lf in leaves_data)
    leaf_count = len(leaves_data)

    conn = get_db()
    cursor = conn.execute(
        'INSERT INTO plants (treatment, coef, total_area, leaf_count, operator, note) VALUES (?, ?, ?, ?, ?, ?)',
        (treatment, coef, total_area, leaf_count, operator, note)
    )
    plant_id = cursor.lastrowid

    for i, lf in enumerate(leaves_data):
        area = lf['l'] * lf['w'] * coef
        conn.execute(
            'INSERT INTO leaves (plant_id, leaf_index, length, width, area) VALUES (?, ?, ?, ?, ?)',
            (plant_id, i + 1, lf['l'], lf['w'], area)
        )

    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'id': plant_id, 'total_area': total_area})

@app.route('/api/plants/<int:pid>', methods=['PUT'])
def update_plant(pid):
    data = request.json
    treatment = data.get('treatment', '')
    coef = data.get('coef', 0.75)
    leaves_data = data.get('leaves', [])

    total_area = sum(lf['l'] * lf['w'] * coef for lf in leaves_data)
    leaf_count = len(leaves_data)

    conn = get_db()
    conn.execute(
        'UPDATE plants SET treatment=?, coef=?, total_area=?, leaf_count=? WHERE id=?',
        (treatment, coef, total_area, leaf_count, pid)
    )
    conn.execute('DELETE FROM leaves WHERE plant_id = ?', (pid,))
    for i, lf in enumerate(leaves_data):
        area = lf['l'] * lf['w'] * coef
        conn.execute(
            'INSERT INTO leaves (plant_id, leaf_index, length, width, area) VALUES (?, ?, ?, ?, ?)',
            (pid, i + 1, lf['l'], lf['w'], area)
        )
    conn.commit()
    conn.close()
    return jsonify({'ok': True})

@app.route('/api/plants/<int:pid>', methods=['DELETE'])
def del_plant(pid):
    conn = get_db()
    conn.execute('DELETE FROM leaves WHERE plant_id = ?', (pid,))
    conn.execute('DELETE FROM plants WHERE id = ?', (pid,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})

# ==================== 导出CSV ====================

@app.route('/api/export')
def export_csv():
    treat = request.args.get('treatment', '')
    conn = get_db()

    if treat and treat != '全部':
        plants = conn.execute(
            'SELECT * FROM plants WHERE treatment = ? ORDER BY id', (treat,)
        ).fetchall()
    else:
        plants = conn.execute('SELECT * FROM plants ORDER BY id').fetchall()

    output = io.StringIO()
    output.write('\ufeff')  # BOM
    writer = csv.writer(output)
    writer.writerow(['株号', '处理', '叶位', '叶长(cm)', '叶宽(cm)', '系数', '单叶面积(cm²)', '株总面积(cm²)', '记录人', '时间'])

    for p in plants:
        leaves = conn.execute(
            'SELECT * FROM leaves WHERE plant_id = ? ORDER BY leaf_index', (p['id'],)
        ).fetchall()
        for i, lf in enumerate(leaves):
            writer.writerow([
                p['id'],
                p['treatment'],
                lf['leaf_index'],
                lf['length'],
                lf['width'],
                p['coef'],
                f"{lf['area']:.2f}",
                f"{p['total_area']:.2f}" if i == 0 else '',
                p['operator'] if i == 0 else '',
                p['created_at'] if i == 0 else ''
            ])

    conn.close()

    output.seek(0)
    return send_file(
        io.BytesIO(output.getvalue().encode('utf-8-sig')),
        mimetype='text/csv',
        as_attachment=True,
        download_name=f'leaf_area_{treat}_{datetime.now().strftime("%Y%m%d")}.csv'
    )

# ==================== 数据库备份下载 ====================

@app.route('/api/backup')
def backup_db():
    """直接下载数据库文件作为备份"""
    return send_file(DB_PATH, as_attachment=True, download_name=f'leaf_backup_{datetime.now().strftime("%Y%m%d_%H%M")}.db')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)
